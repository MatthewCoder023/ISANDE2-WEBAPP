const MixRequest = require('../models/MixRequest');
const ColorFormula = require('../models/ColorFormula');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
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
  const request = await MixRequest.findById(req.params.id);
  if (!request) throw new ApiError(404, 'Mix request not found.');
  if (![MIX_STATUS.QUEUED, MIX_STATUS.MIXING].includes(request.status)) {
    throw new ApiError(409, `A ${request.status} request cannot be completed.`);
  }

  const { formulaId, newFormula, mixerNotes } = req.body;
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
  await request.save();

  res.json({
    success: true,
    message: `${request.requestNumber} completed${formula ? ` using formula "${formula.name}"` : ''}.`,
    data: { request: request.toJSON(), formula: formula ? formula.toJSON() : null },
  });
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

module.exports = { create, list, stats, getById, start, complete, cancel };
