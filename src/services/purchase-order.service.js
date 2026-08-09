const PurchaseOrder = require('../models/PurchaseOrder');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const ApiError = require('../utils/ApiError');
const inventoryService = require('./inventory.service');
const { MOVEMENT_TYPES } = require('../constants/products');
const { PO_STATUS, OPEN_PO_STATUSES } = require('../constants/purchasing');

const round2 = (n) => Math.round(n * 100) / 100;

/** Records a status change and its history entry in one place. */
function transition(po, status, { by = null, note = '' } = {}) {
  po.status = status;
  po.statusHistory.push({ status, at: new Date(), by, note });
}

/**
 * Resolves requested lines against the live catalogue.
 *
 * Names, SKUs and totals are computed here rather than accepted from the
 * request, for the same reason customer orders are priced server-side: a
 * document stating what the shop owes a supplier must be built from the
 * shop's own records, not from whatever the browser posted.
 *
 * Unit cost is the exception and *is* supplied — it is what the supplier
 * quoted, which is a fact the catalogue does not know. It defaults to the
 * product's selling price only as a starting point in the UI.
 */
async function buildItems(requestedItems) {
  // Merge duplicate lines for the same product so a PO never lists one
  // product twice with two different quantities.
  const merged = new Map();
  for (const line of requestedItems) {
    const key = String(line.productId);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += line.quantity;
      // A later line's cost wins: it is the more recently entered figure.
      if (line.unitCost !== undefined) existing.unitCost = line.unitCost;
    } else {
      merged.set(key, { ...line, quantity: line.quantity });
    }
  }

  const ids = [...merged.keys()];
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const items = [];
  for (const [id, line] of merged) {
    const product = byId.get(id);
    if (!product) throw new ApiError(404, 'One of the products on this order no longer exists.');
    if (product.isCustom) {
      // Custom mixes are made in-house for one customer; nobody orders them
      // from a supplier, and letting one onto a PO would publish another
      // customer's paint into general stock.
      throw new ApiError(422, 'Custom mixes are produced in-house and cannot be ordered from a supplier.');
    }

    const unitCost = round2(line.unitCost === undefined ? product.price : line.unitCost);
    items.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      unitCost,
      quantityOrdered: line.quantity,
      quantityReceived: null,
      lineTotal: round2(unitCost * line.quantity),
    });
  }

  const subtotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0));
  return { items, subtotal, total: subtotal };
}

/**
 * Raises a purchase order. Deliberately moves no stock: ordering is a
 * promise, not a delivery. Stock changes only in receivePurchaseOrder.
 */
async function createPurchaseOrder({
  supplierId,
  requestedItems,
  expectedDate = null,
  notes = '',
  status = PO_STATUS.DRAFT,
  createdById,
}) {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier || !supplier.isActive) {
    throw new ApiError(404, 'Supplier not found.');
  }

  const { items, subtotal, total } = await buildItems(requestedItems);

  const po = new PurchaseOrder({
    poNumber: await PurchaseOrder.generatePoNumber(),
    supplier: supplier._id,
    supplierName: supplier.name,
    items,
    subtotal,
    total,
    expectedDate,
    notes,
    createdBy: createdById,
    statusHistory: [],
  });
  transition(po, status, { by: createdById });
  await po.save();

  return po;
}

/** Draft to ordered: the document has been sent to the supplier. */
async function markOrdered(po, userId) {
  if (po.status !== PO_STATUS.DRAFT) {
    throw new ApiError(409, 'Only a draft purchase order can be marked as ordered.');
  }
  transition(po, PO_STATUS.ORDERED, { by: userId, note: 'Sent to supplier' });
  await po.save();
  return po;
}

/**
 * Books a delivery in.
 *
 * This is the only place a purchase order touches stock, and it moves the
 * quantity that actually arrived — not the quantity that was ordered. Short
 * deliveries are normal, and recording the optimistic number would leave the
 * shelf count disagreeing with the shelf.
 *
 * Each line goes through the inventory service, so every unit received is a
 * restock movement naming this PO. A line that received nothing produces no
 * movement at all: there is no stock event to record.
 *
 * @param {object} po
 * @param {Array<{sku: string, quantityReceived: number}>} received
 * @param {string} userId
 */
async function receivePurchaseOrder(po, received, userId) {
  if (!OPEN_PO_STATUSES.includes(po.status)) {
    throw new ApiError(409, `A ${po.status} purchase order cannot be received.`);
  }

  const bySku = new Map(received.map((line) => [String(line.sku), line.quantityReceived]));

  // Validate the whole delivery before moving any stock, so a bad line
  // cannot leave half the order booked in.
  for (const item of po.items) {
    const quantity = bySku.get(item.sku);
    if (quantity === undefined) {
      throw new ApiError(422, `Confirm a received quantity for ${item.sku}.`);
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new ApiError(422, `Received quantity for ${item.sku} must be a whole number, 0 or more.`);
    }
    if (quantity > item.quantityOrdered) {
      throw new ApiError(
        422,
        `Received quantity for ${item.sku} is more than the ${item.quantityOrdered} ordered.`
      );
    }
  }

  for (const item of po.items) {
    const quantity = bySku.get(item.sku);
    item.quantityReceived = quantity;
    if (quantity === 0) continue; // nothing arrived, so nothing moved

    // eslint-disable-next-line no-await-in-loop
    await inventoryService.adjustStock({
      productId: item.product,
      type: MOVEMENT_TYPES.RESTOCK,
      quantity,
      reason: `Received on ${po.poNumber} from ${po.supplierName}`,
      userId,
    });
  }

  po.receivedBy = userId;
  po.receivedAt = new Date();

  const short = po.items.some((item) => item.quantityReceived < item.quantityOrdered);
  transition(po, PO_STATUS.RECEIVED, {
    by: userId,
    note: short ? 'Received short of the ordered quantity' : 'Received in full',
  });
  await po.save();

  return po;
}

/** Abandons an order that has not arrived. No stock has moved, so none unwinds. */
async function cancelPurchaseOrder(po, userId, reason = '') {
  if (!OPEN_PO_STATUSES.includes(po.status)) {
    throw new ApiError(409, `A ${po.status} purchase order cannot be cancelled.`);
  }
  po.cancelledAt = new Date();
  po.cancelledReason = reason;
  transition(po, PO_STATUS.CANCELLED, { by: userId, note: reason });
  await po.save();
  return po;
}

module.exports = {
  createPurchaseOrder,
  markOrdered,
  receivePurchaseOrder,
  cancelPurchaseOrder,
};
