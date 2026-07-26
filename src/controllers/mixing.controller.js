const MixRequest = require('../models/MixRequest');
const ColorFormula = require('../models/ColorFormula');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const mixFulfillment = require('../services/mix-fulfillment.service');
const { notifyMixReady, notifyStaffMixRequested } = require('../services/notify.service');
const { ROLES } = require('../constants/roles');
const { MIX_STATUS } = require('../constants/mixing');

const canManage = (role) => role === ROLES.PAINT_MIXER || role === ROLES.ADMIN;
const canViewAll = (role) => canManage(role) || role === ROLES.CASHIER;

function parsePagination(query, defaultLimit = 10) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);
  return { page, limit, skip: (page - 1) * limit };
}

/** POST /api/mixing/requests — any authenticated user. */
const create = asyncHandler(async (req, res) => {
  const { targetColor, productId, quantity, notes, customerName } = req.body;

  if (productId) {
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      throw new ApiError(400, 'The selected base product is not available.');
    }
  }

  const isClient = req.user.role === ROLES.CLIENT;
  const request = await MixRequest.create({
    requestNumber: await MixRequest.generateRequestNumber(),
    customer: isClient ? req.user._id : null,
    customerName: isClient ? req.user.fullName : customerName || 'Walk-in Customer',
    targetColor: { hex: targetColor.hex, name: targetColor.name || '' },
    product: productId || null,
    quantity: quantity || 1,
    notes,
    placedBy: req.user._id,
  });

  // Put the job on the mixer's radar without them watching the queue.
  await notifyStaffMixRequested(request);

  res.status(201).json({
    success: true,
    message: `Mix request ${request.requestNumber} submitted. We'll start on it soon!`,
    data: { request: request.toJSON() },
  });
});

/**
 * GET /api/mixing/requests — clients see their own; mixer/cashier/admin
 * see all. ?status accepts a single status or "history"
 * (completed + cancelled, i.e. the production log).
 */
const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};

  if (!canViewAll(req.user.role)) {
    filter.customer = req.user._id;
  }

  if (req.query.status === 'history') {
    filter.status = { $in: [MIX_STATUS.COMPLETED, MIX_STATUS.CANCELLED] };
  } else if (req.query.status === 'active') {
    filter.status = { $in: [MIX_STATUS.QUEUED, MIX_STATUS.MIXING] };
  } else if (Object.values(MIX_STATUS).includes(req.query.status)) {
    filter.status = req.query.status;
  }

  if (req.query.search && canViewAll(req.user.role)) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ requestNumber: pattern }, { customerName: pattern }];
  }

  const [requests, total] = await Promise.all([
    MixRequest.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('product', 'name sku size')
      .populate('formula', 'name colorHex'),
    MixRequest.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      requests,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

/** GET /api/mixing/stats — role-shaped dashboard numbers. */
const stats = asyncHandler(async (req, res) => {
  if (!canViewAll(req.user.role)) {
    const [activeMixes, completedMixes] = await Promise.all([
      MixRequest.countDocuments({
        customer: req.user._id,
        status: { $in: [MIX_STATUS.QUEUED, MIX_STATUS.MIXING] },
      }),
      MixRequest.countDocuments({ customer: req.user._id, status: MIX_STATUS.COMPLETED }),
    ]);
    return res.json({ success: true, data: { stats: { activeMixes, completedMixes } } });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [queued, mixing, completedToday, formulas] = await Promise.all([
    MixRequest.countDocuments({ status: MIX_STATUS.QUEUED }),
    MixRequest.countDocuments({ status: MIX_STATUS.MIXING }),
    MixRequest.countDocuments({
      status: MIX_STATUS.COMPLETED,
      completedAt: { $gte: todayStart },
    }),
    ColorFormula.countDocuments({ isActive: true }),
  ]);

  res.json({ success: true, data: { stats: { queued, mixing, completedToday, formulas } } });
});

/** Loads a request and enforces ownership for customers. */
async function loadRequestForUser(id, user) {
  const request = await MixRequest.findById(id)
    .populate('product', 'name sku size')
    .populate('formula', 'name colorHex components notes');
  if (!request) throw new ApiError(404, 'Mix request not found.');
  if (!canViewAll(user.role) && (!request.customer || !request.customer.equals(user._id))) {
    throw new ApiError(404, 'Mix request not found.');
  }
  return request;
}

/** GET /api/mixing/requests/:id */
const getById = asyncHandler(async (req, res) => {
  const request = await loadRequestForUser(req.params.id, req.user);
  res.json({ success: true, data: { request: request.toJSON() } });
});

/** POST /api/mixing/requests/:id/start — mixer/admin, queued -> mixing. */
const start = asyncHandler(async (req, res) => {
  const request = await MixRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Mix request not found.');
  if (request.status !== MIX_STATUS.QUEUED) {
    throw new ApiError(409, `A ${request.status} request cannot be started.`);
  }

  request.status = MIX_STATUS.MIXING;
  request.startedAt = new Date();
  await request.save();

  res.json({
    success: true,
    message: `${request.requestNumber} is now on the bench.`,
    data: { request: request.toJSON() },
  });
});

/**
 * POST /api/mixing/requests/:id/complete — mixer/admin.
 * Optionally attaches an existing formula (reuse) or records a new one.
 */
const complete = asyncHandler(async (req, res) => {
  // The base paint is populated because it decides both the quote and the
  // shape of the product published for sale.
  const request = await MixRequest.findById(req.params.id).populate('product');
  if (!request) throw new ApiError(404, 'Mix request not found.');
  if (![MIX_STATUS.QUEUED, MIX_STATUS.MIXING].includes(request.status)) {
    throw new ApiError(409, `A ${request.status} request cannot be completed.`);
  }

  const { formulaId, newFormula, mixerNotes, unitPrice } = req.body;
  let formula = null;

  if (formulaId) {
    formula = await ColorFormula.findOneAndUpdate(
      { _id: formulaId, isActive: true },
      { $inc: { timesUsed: 1 } },
      { new: true }
    );
    if (!formula) throw new ApiError(400, 'The selected formula is not available.');
  } else if (newFormula) {
    formula = await ColorFormula.create({
      name: newFormula.name,
      colorHex: newFormula.colorHex,
      components: newFormula.components,
      notes: newFormula.notes || '',
      createdBy: req.user._id,
      timesUsed: 1,
    });
  }

  request.status = MIX_STATUS.COMPLETED;
  request.completedAt = new Date();
  request.formula = formula ? formula._id : null;
  if (mixerNotes !== undefined) request.mixerNotes = mixerNotes;

  // Publish the finished paint so the customer can actually buy it. Staff
  // jobs with no customer account skip this and behave exactly as before.
  const price =
    unitPrice !== undefined && unitPrice !== null
      ? unitPrice
      : await mixFulfillment.quoteUnitPrice(request);

  const readyProduct = await mixFulfillment.publishMixProduct(request, {
    unitPrice: price,
    actorId: req.user._id,
  });

  if (readyProduct) {
    request.unitPrice = price;
    request.pricedBy = req.user._id;
    request.readyProduct = readyProduct._id;
  }

  await request.save();

  if (readyProduct) await notifyMixReady(request, readyProduct);

  res.json({
    success: true,
    message:
      `${request.requestNumber} completed${formula ? ` using formula "${formula.name}"` : ''}.` +
      (readyProduct ? ' It is now in the customer’s cart, ready to buy.' : ''),
    data: {
      request: request.toJSON(),
      formula: formula ? formula.toJSON() : null,
      readyProduct: readyProduct ? readyProduct.toJSON() : null,
    },
  });
});

/**
 * GET /api/mixing/ready — the caller's finished mixes that have been
 * published for sale but not yet placed in their cart. The client merges
 * these in on load, which is how an approved mix "appears" in the cart
 * despite the cart living in the browser.
 */
const listReady = asyncHandler(async (req, res) => {
  const requests = await MixRequest.find({
    customer: req.user._id,
    status: MIX_STATUS.COMPLETED,
    readyProduct: { $ne: null },
    addedToCartAt: null,
  })
    .sort('-completedAt')
    .limit(20)
    .populate('readyProduct');

  // Only offer paints that are still actually buyable.
  const items = requests
    .filter((r) => r.readyProduct && r.readyProduct.isActive && r.readyProduct.stock.quantity > 0)
    .map((r) => ({
      requestId: r.id,
      requestNumber: r.requestNumber,
      quantity: r.quantity,
      product: r.readyProduct.toJSON(),
    }));

  res.json({ success: true, data: { items } });
});

/**
 * POST /api/mixing/ready/ack — marks mixes as delivered to the cart so the
 * auto-add happens once and a later removal is respected.
 */
const acknowledgeReady = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.requestIds) ? req.body.requestIds.slice(0, 20) : [];
  if (ids.length === 0) {
    return res.json({ success: true, data: { acknowledged: 0 } });
  }

  const result = await MixRequest.updateMany(
    { _id: { $in: ids }, customer: req.user._id, addedToCartAt: null },
    { $set: { addedToCartAt: new Date() } }
  );

  res.json({ success: true, data: { acknowledged: result.modifiedCount } });
});

/**
 * POST /api/mixing/requests/:id/cancel — customers may cancel their own
 * request while queued; mixer/admin may cancel queued or mixing requests.
 */
const cancel = asyncHandler(async (req, res) => {
  const request = await loadRequestForUser(req.params.id, req.user);

  if (!canManage(req.user.role)) {
    if (req.user.role !== ROLES.CLIENT || request.status !== MIX_STATUS.QUEUED) {
      throw new ApiError(409, 'This request is already being mixed. Please contact the store.');
    }
  } else if (![MIX_STATUS.QUEUED, MIX_STATUS.MIXING].includes(request.status)) {
    throw new ApiError(409, `A ${request.status} request cannot be cancelled.`);
  }

  request.status = MIX_STATUS.CANCELLED;
  request.cancelledAt = new Date();
  await request.save();

  res.json({
    success: true,
    message: `Mix request ${request.requestNumber} cancelled.`,
    data: { request: request.toJSON() },
  });
});

module.exports = {
  create,
  list,
  stats,
  getById,
  start,
  complete,
  cancel,
  listReady,
  acknowledgeReady,
};
