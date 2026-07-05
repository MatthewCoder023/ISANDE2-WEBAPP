const fs = require('fs');
const path = require('path');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const inventoryService = require('./inventory.service');
const {
  ORDER_STATUS,
  ORDER_TYPES,
  PAYMENT_METHODS,
  CANCELLABLE_STATUSES,
} = require('../constants/orders');
const { MOVEMENT_TYPES } = require('../constants/products');

const round2 = (n) => Math.round(n * 100) / 100;

const PROOFS_DIR = path.join(__dirname, '..', '..', 'uploads', 'proofs');

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
function attachProof(order, file, userId) {
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
  return order.save();
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

  return { order, transaction };
}

/** Staff rejects the proof: back to pending_payment with a reason. */
function rejectPayment(order, staffId, reason) {
  if (order.status !== ORDER_STATUS.PENDING_VERIFICATION) {
    throw new ApiError(409, 'This order has no payment awaiting verification.');
  }

  order.payment.rejectedReason = reason;
  transition(order, ORDER_STATUS.PENDING_PAYMENT, {
    by: staffId,
    note: `Proof rejected: ${reason}`,
  });
  return order.save();
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
function markReady(order, staffId) {
  if (order.status !== ORDER_STATUS.PREPARING) {
    throw new ApiError(409, `A ${order.status} order cannot be marked ready.`);
  }
  order.readyAt = new Date();
  transition(order, ORDER_STATUS.READY, { by: staffId, note: 'Ready for pickup' });
  return order.save();
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
async function cancelOrder(order, userId) {
  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    throw new ApiError(409, `A ${order.status} order cannot be cancelled.`);
  }

  await releaseStock(order.items, `Order ${order.orderNumber} cancelled`, userId);

  order.cancelledAt = new Date();
  // Money already taken (verified GCash) is settled outside the system.
  const note = order.paidAt ? 'Cancelled — refund to be arranged with the store' : '';
  transition(order, ORDER_STATUS.CANCELLED, { by: userId, note });
  await order.save();

  return order;
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
  walkInSale,
  PROOFS_DIR,
};
