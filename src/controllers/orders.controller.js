const fs = require('fs');
const path = require('path');

const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const orderService = require('../services/order.service');
const { renderInvoice } = require('../services/pdf.service');
const { verifyCode, documentCode } = require('../services/document.service');
const { toSectionedCsv, sendCsv } = require('../utils/csv');
const { PROOFS_DIR } = require('../middleware/upload');
const { ROLES } = require('../constants/roles');
const { ORDER_STATUS, ORDER_TYPES } = require('../constants/orders');

const isStaff = (role) => role === ROLES.CASHIER || role === ROLES.ADMIN;

/**
 * Whitelisted sorts for the staff list. Anything unrecognised falls back to
 * newest-first, so a hand-typed parameter can never reach the query.
 */
const ORDER_SORTS = {
  newest: '-createdAt',
  oldest: 'createdAt',
  total_desc: '-total',
  total_asc: 'total',
  status: 'status',
};

const orderSort = (key) => ORDER_SORTS[key] || ORDER_SORTS.newest;

function parsePagination(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

/** POST /api/orders — customer places an online order (checkout step 1). */
const placeOrder = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  if (!settings.acceptOnlineOrders) {
    throw new ApiError(
      503,
      'Online ordering is temporarily paused — please visit us in store or try again later.'
    );
  }

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
    message: `Order ${order.orderNumber} placed! Next step: payment.`,
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

  // "active" is a pseudo-status matching the dashboard's Active Orders
  // count, so that tile can link straight to the orders it counted.
  if (req.query.status === 'active') {
    filter.status = { $nin: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED] };
  } else if (Object.values(ORDER_STATUS).includes(req.query.status)) {
    filter.status = req.query.status;
  }

  if (isStaff(req.user.role)) {
    if (Object.values(ORDER_TYPES).includes(req.query.type)) filter.type = req.query.type;
    // Customer-records view: a specific customer's order history.
    if (req.query.customer) filter.customer = req.query.customer;
    if (req.query.search) {
      const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
      filter.$or = [{ orderNumber: pattern }, { customerName: pattern }];
    }
  } else {
    filter.customer = req.user._id;
  }

  const [orders, total] = await Promise.all([
    Order.find(filter).sort(orderSort(req.query.sort)).skip(skip).limit(limit),
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
        status: { $nin: [ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED] },
      }),
      Order.countDocuments({ customer: req.user._id, status: ORDER_STATUS.COMPLETED }),
    ]);
    return res.json({ success: true, data: { stats: { activeOrders, completedOrders } } });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const [
    salesTodayAgg,
    transactionsToday,
    awaitingVerification,
    preparingOrders,
    readyOrders,
    revenueMonthAgg,
    totalOrders,
  ] = await Promise.all([
    Transaction.aggregate([
      { $match: { createdAt: { $gte: todayStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.countDocuments({ createdAt: { $gte: todayStart } }),
    Order.countDocuments({ status: ORDER_STATUS.PENDING_VERIFICATION }),
    Order.countDocuments({
      status: { $in: [ORDER_STATUS.PAYMENT_VERIFIED, ORDER_STATUS.PREPARING] },
    }),
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
        awaitingVerification,
        preparingOrders,
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

/** GET /api/orders/:id — detail incl. payment record when paid. */
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

/**
 * GET /api/orders/:id/invoice.pdf — the invoice as a real file, for the
 * order's owner or any staff member. The browser-print path on the invoice
 * page remains; this is the archivable, emailable version.
 */
const invoicePdf = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  const transaction = await Transaction.findOne({ order: order._id });

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const pdf = await renderInvoice(order, transaction, { appUrl });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="invoice-${order.orderNumber}.pdf"`
  );
  res.send(pdf);
});

/**
 * GET /api/orders/:id/export.csv — the invoice's *content* as data, for
 * anyone who needs the figures in a spreadsheet. Branding and layout do not
 * survive CSV; the PDF above is the presentable document.
 */
const exportOrderCsv = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  const transaction = await Transaction.findOne({ order: order._id });
  const settings = await Setting.get();

  const paid = transaction
    ? `${transaction.method} - paid ${transaction.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`
    : order.payment?.method
      ? `${order.payment.method} - not yet paid`
      : 'Not yet selected';

  const csv = toSectionedCsv([
    {
      title: 'Invoice',
      rows: [
        ['Shop', settings.shopName],
        ['Address', settings.addressLine],
        ['Order Number', order.orderNumber],
        ['Order Date', order.createdAt.toISOString().slice(0, 16).replace('T', ' ')],
        ['Status', order.status],
        ['Payment', paid],
        ['Verification Code', documentCode(order)],
      ],
    },
    {
      title: 'Billed To',
      rows: [['Customer', order.customerName || 'Walk-in Customer']],
    },
    {
      title: 'Items',
      headers: ['Item', 'SKU', 'Unit Price', 'Quantity', 'Amount'],
      rows: order.items.map((i) => [i.name, i.sku, i.price, i.quantity, i.lineTotal]),
    },
    {
      title: 'Totals',
      rows: [
        ['Subtotal', order.subtotal],
        ['Total', order.total],
      ],
    },
  ]);

  sendCsv(res, `invoice-${order.orderNumber}`, csv);
});

/**
 * GET /api/orders/verify — confirms a downloaded document still matches the
 * order on file. Deliberately public: whoever holds the paper needs to be
 * able to check it. It answers only yes/no plus the figures the document
 * already shows, and the code is an HMAC, so it reveals nothing to guessers.
 */
const verifyDocument = asyncHandler(async (req, res) => {
  const orderNumber = String(req.query.order || '').trim();
  const code = String(req.query.code || '').trim();

  const order = orderNumber ? await Order.findOne({ orderNumber }) : null;
  const valid = Boolean(order) && verifyCode(order, code);

  if (!valid) {
    return res.status(404).json({
      success: false,
      message:
        'We could not verify this document. It may have been edited after download, ' +
        'or the code was typed incorrectly.',
      data: { valid: false },
    });
  }

  res.json({
    success: true,
    message: 'This document matches our records.',
    data: {
      valid: true,
      orderNumber: order.orderNumber,
      issuedAt: order.createdAt,
      total: order.total,
      itemCount: order.items.length,
    },
  });
});

/** POST /api/orders/:id/payment-method — customer chooses cash on pickup. */
const chooseCashOnPickup = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  await orderService.chooseCashOnPickup(order, req.user._id);

  res.json({
    success: true,
    message: `Got it — pay for ${order.orderNumber} at the counter when you pick it up. We're preparing it now.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/:id/proof — customer uploads GCash proof (multipart). */
const uploadProof = asyncHandler(async (req, res) => {
  // Multer has already written the file; if anything below rejects the
  // request, remove it so failed uploads never accumulate on disk.
  let order;
  try {
    order = await loadOrderForUser(req.params.id, req.user);
    if (!req.file) {
      throw new ApiError(422, 'Attach a JPG, PNG, or WebP image of your payment.');
    }
    await orderService.attachProof(order, req.file, req.user._id);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    throw err;
  }

  res.json({
    success: true,
    message: `Proof received for ${order.orderNumber}. We'll verify it shortly!`,
    data: { order: order.toJSON() },
  });
});

/** GET /api/orders/:id/proof — the proof image (owner or staff only). */
const getProof = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  if (!order.payment.proof.filename) {
    throw new ApiError(404, 'No proof of payment on this order.');
  }
  res.sendFile(path.join(PROOFS_DIR, order.payment.proof.filename));
});

/** POST /api/orders/:id/verify-payment — staff approves the proof. */
const verifyPayment = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  const { transaction } = await orderService.verifyPayment(order, req.user._id);

  res.json({
    success: true,
    message: `Payment for ${order.orderNumber} verified and recorded.`,
    data: { order: order.toJSON(), transaction: transaction.toJSON() },
  });
});

/** POST /api/orders/:id/reject-payment — staff rejects the proof. */
const rejectPayment = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  await orderService.rejectPayment(order, req.user._id, req.body.reason);

  res.json({
    success: true,
    message: `Proof for ${order.orderNumber} rejected — the customer can upload a new one.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/:id/prepare — staff starts preparing (verified orders). */
const prepare = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  await orderService.startPreparing(order, req.user._id);

  res.json({
    success: true,
    message: `${order.orderNumber} is being prepared.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/:id/ready — staff marks a prepared order ready. */
const markReady = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);
  await orderService.markReady(order, req.user._id);

  res.json({
    success: true,
    message: `Order ${order.orderNumber} is ready for pickup.`,
    data: { order: order.toJSON() },
  });
});

/** POST /api/orders/:id/complete — staff hands over (takes payment if unpaid). */
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
    message: `Order ${order.orderNumber} completed.`,
    data: { order: order.toJSON(), transaction: transaction ? transaction.toJSON() : null },
  });
});

/**
 * POST /api/orders/:id/cancel — customers may cancel while awaiting
 * payment; staff may cancel any not-yet-completed order.
 */
const cancel = asyncHandler(async (req, res) => {
  const order = await loadOrderForUser(req.params.id, req.user);

  if (!isStaff(req.user.role) && order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    throw new ApiError(
      409,
      'This order is already moving through the shop. Please contact the store to cancel it.'
    );
  }

  await orderService.cancelOrder(order, req.user._id);

  res.json({
    success: true,
    message: `Order ${order.orderNumber} cancelled and stock restored.`,
    data: { order: order.toJSON() },
  });
});

module.exports = {
  placeOrder,
  walkInSale,
  list,
  stats,
  getById,
  invoicePdf,
  exportOrderCsv,
  verifyDocument,
  chooseCashOnPickup,
  uploadProof,
  getProof,
  verifyPayment,
  rejectPayment,
  prepare,
  markReady,
  complete,
  cancel,
};
