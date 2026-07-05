const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const orderService = require('../services/order.service');
const { ROLES } = require('../constants/roles');
const { ORDER_STATUS, ORDER_TYPES } = require('../constants/orders');

const isStaff = (role) => role === ROLES.CASHIER || role === ROLES.ADMIN;

function parsePagination(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

/** POST /api/orders — customer places an online order. */
const placeOrder = asyncHandler(async (req, res) => {
  const order = await orderService.createOrder({
    requestedItems: req.body.items,
    notes: req.body.notes,
    type: ORDER_TYPES.ONLINE,
    customerId: req.user._id,
    customerName: req.user.fullName,
    placedById: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `Order ${order.orderNumber} placed! Pay when you pick it up in store.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/walk-in — cashier/admin POS sale, paid immediately. */
const walkInSale = asyncHandler(async (req, res) => {
  const { order, transaction } = await orderService.walkInSale({
    requestedItems: req.body.items,
    customerName: req.body.customerName,
    payment: req.body.payment,
    cashierId: req.user._id,
  });

  res.status(201).json({
    success: true,
    message: `Sale ${order.orderNumber} completed.`,
    data: { order: order.toJSON(), transaction: transaction.toJSON() },
  });
});

/** GET /api/orders — clients see their own; staff see all with filters. */
const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};

  if (isStaff(req.user.role)) {
    if (Object.values(ORDER_STATUS).includes(req.query.status)) filter.status = req.query.status;
    if (Object.values(ORDER_TYPES).includes(req.query.type)) filter.type = req.query.type;
    if (req.query.search) {
      const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
      filter.$or = [{ orderNumber: pattern }, { customerName: pattern }];
    }
  } else {
    filter.customer = req.user._id;
    if (Object.values(ORDER_STATUS).includes(req.query.status)) filter.status = req.query.status;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort('-createdAt').skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      orders,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** GET /api/orders/stats — role-shaped dashboard numbers. */
const stats = asyncHandler(async (req, res) => {
  if (!isStaff(req.user.role)) {
    const [activeOrders, completedOrders] = await Promise.all([
      Order.countDocuments({
        customer: req.user._id,
        status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.READY] },
      }),
      Order.countDocuments({ customer: req.user._id, status: ORDER_STATUS.COMPLETED }),
    ]);
    return res.json({ success: true, data: { stats: { activeOrders, completedOrders } } });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const [salesTodayAgg, transactionsToday, pendingOrders, readyOrders, revenueMonthAgg, totalOrders] =
    await Promise.all([
      Transaction.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.countDocuments({ createdAt: { $gte: todayStart } }),
      Order.countDocuments({ status: ORDER_STATUS.PENDING }),
      Order.countDocuments({ status: ORDER_STATUS.READY }),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Order.countDocuments({}),
    ]);

  res.json({
    success: true,
    data: {
      stats: {
        salesToday: salesTodayAgg[0]?.total || 0,
        transactionsToday,
        pendingOrders,
        readyOrders,
        revenueThisMonth: revenueMonthAgg[0]?.total || 0,
        totalOrders,
      },
    },
  });
});

/** Loads an order and enforces ownership for non-staff. */
async function loadOrderForUser(orderId, user) {
  const order = await Order.findById(orderId);
  if (!order) throw new ApiError(404, 'Order not found.');
  if (!isStaff(user.role) && (!order.customer || !order.customer.equals(user._id))) {
    throw new ApiError(404, 'Order not found.');
  }
  return order;
}

/** GET /api/orders/:id — detail incl. payment record when completed. */
const getById = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  const transaction = await Transaction.findOne({ order: order._id }).populate(
    'receivedBy',
    'firstName lastName'
  );

  res.json({
    success: true,
    data: { order: order.toJSON(), transaction: transaction ? transaction.toJSON() : null },
  });
});

/** POST /api/orders/:id/ready — staff marks a pending order prepared. */
const markReady = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');
  if (order.status !== ORDER_STATUS.PENDING) {
    throw new ApiError(409, `A ${order.status} order cannot be marked ready.`);
  }

  order.status = ORDER_STATUS.READY;
  order.readyAt = new Date();
  await order.save();

  res.json({
    success: true,
    message: `Order ${order.orderNumber} marked as ready for pickup.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/:id/complete — staff takes payment. */
const complete = asyncHandler(async (req, res) => {
  const existing = await Order.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Order not found.');

  const { order, transaction } = await orderService.completeOrder(existing, {
    method: req.body.method,
    amountTendered: req.body.amountTendered,
    cashierId: req.user._id,
  });

  res.json({
    success: true,
    message: `Order ${order.orderNumber} completed and paid.`,
    data: { order: order.toJSON(), transaction: transaction.toJSON() },
  });
});

/**
 * POST /api/orders/:id/cancel — customers may cancel their own order
 * while it is still pending; staff may cancel pending or ready orders.
 */
const cancel = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);

  if (!isStaff(req.user.role) && order.status !== ORDER_STATUS.PENDING) {
    throw new ApiError(
      409,
      'This order is already being prepared. Please contact the store to cancel it.'
    );
  }

  await orderService.cancelOrder(order, req.user._id);

  res.json({
    success: true,
    message: `Order ${order.orderNumber} cancelled and stock restored.`,
    data: { order: order.toJSON() },
  });
});

module.exports = { placeOrder, walkInSale, list, stats, getById, markReady, complete, cancel };
