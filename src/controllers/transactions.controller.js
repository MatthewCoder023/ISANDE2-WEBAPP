const Transaction = require('../models/Transaction');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { PAYMENT_METHODS } = require('../constants/orders');

/** GET /api/transactions — cashier/admin payment log, newest first. */
const list = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const filter = {};
  if (PAYMENT_METHODS.includes(req.query.method)) filter.method = req.query.method;
  if (req.query.search) {
    filter.orderNumber = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
  }

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('receivedBy', 'firstName lastName'),
    Transaction.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      transactions,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

module.exports = { list };
