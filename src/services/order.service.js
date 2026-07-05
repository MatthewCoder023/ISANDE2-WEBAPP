const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const inventoryService = require('./inventory.service');
const { ORDER_STATUS, ORDER_TYPES, PAYMENT_METHODS } = require('../constants/orders');
const { MOVEMENT_TYPES } = require('../constants/products');

const round2 = (n) => Math.round(n * 100) / 100;

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
 * Creates an order with stock reserved. Shared by online ordering
 * (status: pending) and walk-in POS sales (completed by the caller).
 */
async function createOrder({ requestedItems, notes = '', type, customerId = null, customerName = '', placedById }) {
  const { items, subtotal, total } = await priceItems(requestedItems);
  const orderNumber = await Order.generateOrderNumber();

  await reserveStock(items, `Order ${orderNumber}`, placedById);

  try {
    return await Order.create({
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

/** Takes payment and completes the order. Allowed from pending or ready. */
async function completeOrder(order, { method, amountTendered, cashierId }) {
  if (![ORDER_STATUS.PENDING, ORDER_STATUS.READY].includes(order.status)) {
    throw new ApiError(409, `A ${order.status} order cannot be completed.`);
  }

  const payment = settlePayment(order.total, method, amountTendered);

  const transaction = await Transaction.create({
    order: order._id,
    orderNumber: order.orderNumber,
    amount: order.total,
    method,
    amountTendered: payment.amountTendered,
    change: payment.change,
    receivedBy: cashierId,
  });

  const now = new Date();
  order.status = ORDER_STATUS.COMPLETED;
  order.paidAt = now;
  order.completedAt = now;
  await order.save();

  return { order, transaction };
}

/** Cancels an order and restores its stock. Caller enforces role rules. */
async function cancelOrder(order, userId) {
  if (![ORDER_STATUS.PENDING, ORDER_STATUS.READY].includes(order.status)) {
    throw new ApiError(409, `A ${order.status} order cannot be cancelled.`);
  }

  await releaseStock(order.items, `Order ${order.orderNumber} cancelled`, userId);

  order.status = ORDER_STATUS.CANCELLED;
  order.cancelledAt = new Date();
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

module.exports = { createOrder, completeOrder, cancelOrder, walkInSale };
