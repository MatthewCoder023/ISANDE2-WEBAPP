const fs = require('fs');
const path = require('path');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const inventoryService = require('./inventory.service');
const { notifyOrderEvent, notifyStaffProofUploaded } = require('./notify.service');
const {
  ORDER_STATUS,
  ORDER_TYPES,
  PAYMENT_METHODS,
  CANCELLABLE_STATUSES,
} = require('../constants/orders');
const { MOVEMENT_TYPES } = require('../constants/products');
const { PROOFS_DIR } = require('../config/uploads');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Applies a status change and records it in the order's history —
 * every transition in this file goes through here so the tracker
 * timeline is always complete.
 */
function transition(order, status, { by = null, note = '' } = {}) {
  order.status = status;
  order.statusHistory.push({ status, at: new Date(), by, note });
}

/**
 * Resolves requested items against the live catalog and prices them
 * server-side. Client-submitted prices are never trusted; only
 * productId + quantity come from the request.
 */
async function priceItems(requestedItems) {
  // Merge duplicate lines for the same product.
  const qtyByProduct = new Map();
  for (const { productId, quantity } of requestedItems) {
    qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + quantity);
  }

  const ids = [...qtyByProduct.keys()];
  const products = await Product.find({ _id: { $in: ids }, isActive: true });

  if (products.length !== ids.length) {
    throw new ApiError(400, 'One or more products are no longer available.');
  }

  const items = products.map((product) => {
    const quantity = qtyByProduct.get(product.id);
    return {
      product: product._id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      quantity,
      lineTotal: round2(product.price * quantity),
    };
  });

  const subtotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0));
  return { items, subtotal, total: subtotal };
}

/**
 * Reserves stock for every line item as 'sale' movements. Without
 * multi-document transactions (standalone mongod), failures are handled
 * by compensation: any decrements already applied are reversed before
 * the error propagates, so stock never leaks.
 */
async function reserveStock(items, reason, userId) {
  const applied = [];
  for (const item of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await inventoryService.adjustStock({
        productId: item.product,
        type: MOVEMENT_TYPES.SALE,
        quantity: -item.quantity,
        reason,
        userId,
      });
      applied.push(item);
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await releaseStock(applied, `Rollback: ${reason}`, userId);
      if (err instanceof ApiError && err.statusCode === 409) {
        throw new ApiError(409, `Not enough stock for "${item.name}".`);
      }
      throw err;
    }
  }
}

async function releaseStock(items, reason, userId) {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await inventoryService.adjustStock({
      productId: item.product,
      type: MOVEMENT_TYPES.RETURN,
      quantity: item.quantity,
      reason,
      userId,
    });
  }
}

/**
 * Creates an order with stock reserved. Online orders start at
 * pending_payment (the checkout flow takes it from there); walk-in POS
 * sales are completed by the caller immediately after.
 */
/**
 * A custom mix is a single batch made for one person. Once it has been
 * bought there is nothing left to sell, and leaving it active would clutter
 * that customer's catalogue with a permanently out-of-stock entry. Archiving
 * keeps the order history and stock trail intact — it only takes the product
 * off the shelf. Catalogue paints are never touched: running out is normal
 * for them, and it should show up as a restock alert.
 */
async function retireSoldOutCustomMixes(items) {
  try {
    await Product.updateMany(
      {
        _id: { $in: items.map((item) => item.product) },
        isCustom: true,
        isActive: true,
        'stock.quantity': { $lte: 0 },
      },
      { $set: { isActive: false } }
    );
  } catch (err) {
    // Housekeeping must never fail a completed sale.
    console.error('Could not retire sold-out custom mixes:', err.message);
  }
}

/** The mirror of the above: a cancelled sale puts the batch back on offer. */
async function restoreCustomMixes(items) {
  try {
    await Product.updateMany(
      {
        _id: { $in: items.map((item) => item.product) },
        isCustom: true,
        isActive: false,
        'stock.quantity': { $gt: 0 },
      },
      { $set: { isActive: true } }
    );
  } catch (err) {
    console.error('Could not restore custom mixes after cancellation:', err.message);
  }
}

async function createOrder({ requestedItems, notes = '', type, customerId = null, customerName = '', placedById }) {
  const { items, subtotal, total } = await priceItems(requestedItems);
  const orderNumber = await Order.generateOrderNumber();

  await reserveStock(items, `Order ${orderNumber}`, placedById);

  try {
    const order = new Order({
      orderNumber,
      type,
      customer: customerId,
      customerName,
      items,
      subtotal,
      total,
      notes,
      placedBy: placedById,
    });
    transition(order, ORDER_STATUS.PENDING_PAYMENT, { by: placedById, note: 'Order placed' });
    await order.save();

    await retireSoldOutCustomMixes(items);
    return order;
  } catch (err) {
    // Order document failed after stock was taken — give it back.
    await releaseStock(items, `Rollback: order ${orderNumber} could not be saved`, placedById);
    throw err;
  }
}

/**
 * Validates the payment and returns { amountTendered, change }.
 * Non-cash methods are charged exactly the total.
 */
function settlePayment(total, method, amountTendered) {
  if (!PAYMENT_METHODS.includes(method)) {
    throw new ApiError(422, 'Invalid payment method.');
  }
  if (method !== 'cash') {
    return { amountTendered: total, change: 0 };
  }
  if (typeof amountTendered !== 'number' || Number.isNaN(amountTendered)) {
    throw new ApiError(422, 'Amount tendered is required for cash payments.');
  }
  if (amountTendered < total) {
    throw new ApiError(422, 'Amount tendered is less than the order total.');
  }
  return { amountTendered: round2(amountTendered), change: round2(amountTendered - total) };
}

/** Customer confirms cash-on-pickup: no proof needed, start preparing. */
function chooseCashOnPickup(order, userId) {
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    throw new ApiError(409, 'A payment method has already been arranged for this order.');
  }
  order.payment.method = 'cash_on_pickup';
  order.payment.rejectedReason = '';
  transition(order, ORDER_STATUS.PREPARING, {
    by: userId,
    note: 'Cash on pickup — pay at the counter when collecting',
  });
  return order.save();
}

/** Customer uploads GCash proof: awaits staff verification. */
async function attachProof(order, file, userId) {
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    throw new ApiError(409, 'This order is not awaiting payment.');
  }

  // A rejected proof being replaced — drop the old file, best effort.
  if (order.payment.proof.filename) {
    fs.unlink(path.join(PROOFS_DIR, order.payment.proof.filename), () => {});
  }

  order.payment.method = 'gcash';
  order.payment.rejectedReason = '';
  order.payment.proof = {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  };
  transition(order, ORDER_STATUS.PENDING_VERIFICATION, {
    by: userId,
    note: 'Proof of payment submitted',
  });
  await order.save();

  // Tell the counter there is something waiting to be checked.
  await notifyStaffProofUploaded(order);
  return order;
}

/** Staff approves the proof: the money is now recorded as a Transaction. */
async function verifyPayment(order, staffId) {
  if (order.status !== ORDER_STATUS.PENDING_VERIFICATION) {
    throw new ApiError(409, 'This order has no payment awaiting verification.');
  }

  const transaction = await Transaction.create({
    order: order._id,
    orderNumber: order.orderNumber,
    amount: order.total,
    method: 'gcash',
    amountTendered: order.total,
    change: 0,
    receivedBy: staffId,
  });

  order.payment.verifiedBy = staffId;
  order.payment.verifiedAt = new Date();
  order.paidAt = new Date();
  transition(order, ORDER_STATUS.PAYMENT_VERIFIED, { by: staffId, note: 'Payment verified' });
  await order.save();
  await notifyOrderEvent(order, 'payment_verified');

  return { order, transaction };
}

/** Staff rejects the proof: back to pending_payment with a reason. */
async function rejectPayment(order, staffId, reason) {
  if (order.status !== ORDER_STATUS.PENDING_VERIFICATION) {
    throw new ApiError(409, 'This order has no payment awaiting verification.');
  }

  order.payment.rejectedReason = reason;
  transition(order, ORDER_STATUS.PENDING_PAYMENT, {
    by: staffId,
    note: `Proof rejected: ${reason}`,
  });
  await order.save();
  await notifyOrderEvent(order, 'payment_rejected');
  return order;
}

/** Staff starts preparing a verified order. */
function startPreparing(order, staffId) {
  if (order.status !== ORDER_STATUS.PAYMENT_VERIFIED) {
    throw new ApiError(409, `A ${order.status} order cannot be moved to preparing.`);
  }
  transition(order, ORDER_STATUS.PREPARING, { by: staffId });
  return order.save();
}

/** Staff marks a prepared order ready for pickup. */
async function markReady(order, staffId) {
  if (order.status !== ORDER_STATUS.PREPARING) {
    throw new ApiError(409, `A ${order.status} order cannot be marked ready.`);
  }
  order.readyAt = new Date();
  transition(order, ORDER_STATUS.READY, { by: staffId, note: 'Ready for pickup' });
  await order.save();
  await notifyOrderEvent(order, 'ready');
  return order;
}

/**
 * Hands the order over. If it was already paid (verified GCash), no
 * payment is taken; otherwise (cash on pickup / walk-in / customer pays
 * at the counter early) a payment settles it now.
 */
async function completeOrder(order, { method, amountTendered, cashierId }) {
  const completableFrom = [
    ORDER_STATUS.PENDING_PAYMENT,
    ORDER_STATUS.PAYMENT_VERIFIED,
    ORDER_STATUS.PREPARING,
    ORDER_STATUS.READY,
  ];
  if (!completableFrom.includes(order.status)) {
    const hint =
      order.status === ORDER_STATUS.PENDING_VERIFICATION
        ? 'Review the submitted payment first.'
        : '';
    throw new ApiError(409, `A ${order.status} order cannot be completed. ${hint}`.trim());
  }

  let transaction = null;

  if (order.paidAt) {
    transaction = await Transaction.findOne({ order: order._id });
  } else {
    const payment = settlePayment(order.total, method, amountTendered);
    transaction = await Transaction.create({
      order: order._id,
      orderNumber: order.orderNumber,
      amount: order.total,
      method,
      amountTendered: payment.amountTendered,
      change: payment.change,
      receivedBy: cashierId,
    });
    order.paidAt = new Date();
  }

  order.completedAt = new Date();
  transition(order, ORDER_STATUS.COMPLETED, { by: cashierId, note: 'Order handed over' });
  await order.save();

  return { order, transaction };
}

/** Cancels an order and restores its stock. Caller enforces role rules. */
async function cancelOrder(order, userId, noteOverride) {
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new ApiError(409, `A ${order.status} order cannot be cancelled.`);
  }

  await releaseStock(order.items, `Order ${order.orderNumber} cancelled`, userId);
  await restoreCustomMixes(order.items);

  order.cancelledAt = new Date();
  // Money already taken (verified GCash) is settled outside the system.
  const defaultNote = order.paidAt ? 'Cancelled — refund to be arranged with the store' : '';
  transition(order, ORDER_STATUS.CANCELLED, { by: userId, note: noteOverride ?? defaultNote });
  await order.save();

  return order;
}

/** An unpaid online order may sit this long before it is auto-cancelled. */
const STALE_PAYMENT_HOURS = 48;

/**
 * Sweeps abandoned checkouts: pending_payment orders with no activity for
 * STALE_PAYMENT_HOURS are cancelled and their reserved stock returns to
 * the shelf. The clock reads updatedAt, not createdAt — a proof upload or
 * a rejection resets it, so an actively retrying customer is never cut off.
 * Returns the number of orders cancelled.
 */
async function expireStaleOrders() {
  const cutoff = new Date(Date.now() - STALE_PAYMENT_HOURS * 60 * 60 * 1000);
  const stale = await Order.find({
    status: ORDER_STATUS.PENDING_PAYMENT,
    updatedAt: { $lt: cutoff },
  });

  let cancelled = 0;
  for (const order of stale) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await cancelOrder(
        order,
        null,
        `Auto-cancelled — payment was not received within ${STALE_PAYMENT_HOURS} hours`
      );
      // eslint-disable-next-line no-await-in-loop
      await notifyOrderEvent(order, 'auto_cancelled');
      cancelled += 1;
    } catch {
      // One bad order must not stop the sweep; it will retry next run.
    }
  }
  return cancelled;
}

/**
 * A proof file is written to disk before the order that names it is saved,
 * and only two paths ever delete one — a rejected upload, and a replaced
 * proof. Anything else (an order removed, a database restored from a
 * backup, a wiped dev database) strands the file forever. Payment
 * screenshots are personal data, so keeping them past the order they belong
 * to is a liability rather than caution.
 */
const ORPHAN_GRACE_HOURS = 24;

/**
 * Deletes proof files no order refers to.
 *
 * The grace period is what makes this safe to run against a live app: for
 * the moment between multer writing the file and the order being saved, a
 * perfectly good proof looks exactly like an orphan. Nothing recent is ever
 * touched, so that window can never be swept out from under a request.
 *
 * Returns the number deleted. A failure to read the directory or query the
 * orders means we cannot tell what is orphaned, so nothing is removed.
 */
async function sweepOrphanedProofs({ graceHours = ORPHAN_GRACE_HOURS } = {}) {
  let files;
  try {
    files = await fs.promises.readdir(PROOFS_DIR);
  } catch {
    return 0; // no directory yet, or unreadable — nothing safe to do
  }
  if (files.length === 0) return 0;

  const referenced = new Set(
    (await Order.find({ 'payment.proof.filename': { $ne: '' } }).select('payment.proof.filename'))
      .map((order) => order.payment?.proof?.filename)
      .filter(Boolean)
  );

  const cutoff = Date.now() - graceHours * 60 * 60 * 1000;
  let deleted = 0;

  for (const name of files) {
    if (referenced.has(name)) continue;
    // Only ever the kind of file this app writes. Anything else in the
    // directory belongs to someone else and is not ours to delete.
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;

    const filePath = path.join(PROOFS_DIR, name);
    try {
      // eslint-disable-next-line no-await-in-loop
      const { mtimeMs } = await fs.promises.stat(filePath);
      if (mtimeMs >= cutoff) continue; // still inside the upload window
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.unlink(filePath);
      deleted += 1;
    } catch {
      // Already gone, or not ours to remove; the next sweep will retry.
    }
  }

  return deleted;
}

/** One-step POS sale: create + pay + complete. */
async function walkInSale({ requestedItems, customerName, payment, cashierId }) {
  // Validate payment against the priced total BEFORE touching stock,
  // so a short cash payment never creates movements to unwind.
  const { total } = await priceItems(requestedItems);
  settlePayment(total, payment.method, payment.amountTendered);

  const order = await createOrder({
    requestedItems,
    type: ORDER_TYPES.WALK_IN,
    customerName: customerName || 'Walk-in Customer',
    placedById: cashierId,
  });

  return completeOrder(order, {
    method: payment.method,
    amountTendered: payment.amountTendered,
    cashierId,
  });
}

module.exports = {
  createOrder,
  chooseCashOnPickup,
  attachProof,
  verifyPayment,
  rejectPayment,
  startPreparing,
  markReady,
  completeOrder,
  cancelOrder,
  expireStaleOrders,
  STALE_PAYMENT_HOURS,
  sweepOrphanedProofs,
  ORPHAN_GRACE_HOURS,
  walkInSale,
  PROOFS_DIR,
};
