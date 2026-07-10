const Transaction = require('../models/Transaction');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { toCsv, sendCsv } = require('../utils/csv');
const { PAYMENT_METHODS } = require('../constants/orders');

function buildFilter(query) {
  const filter = {};
  if (PAYMENT_METHODS.includes(query.method)) filter.method = query.method;
  if (query.search) {
    filter.orderNumber = new RegExp(escapeRegExp(query.search.trim()), 'i');
  }
  return filter;
}

/** GET /api/transactions — cashier/admin payment log, newest first. */
const list = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const filter = buildFilter(req.query);

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

/** GET /api/transactions/export — the payment log as a CSV download. */
const exportCsv = asyncHandler(async (req, res) => {
  const transactions = await Transaction.find(buildFilter(req.query))
    .sort('-createdAt')
    .limit(5000)
    .populate('receivedBy', 'firstName lastName');

  const rows = transactions.map((t) => [
    t.createdAt.toISOString().replace('T', ' ').slice(0, 19),
    t.orderNumber,
    t.method,
    t.amount,
    t.amountTendered,
    t.change,
    t.receivedBy ? `${t.receivedBy.firstName} ${t.receivedBy.lastName}` : '',
  ]);

  const csv = toCsv(
    ['Date', 'Order Number', 'Method', 'Amount', 'Amount Tendered', 'Change', 'Received By'],
    rows
  );
  sendCsv(res, 'transactions', csv);
});

module.exports = { list, exportCsv };
