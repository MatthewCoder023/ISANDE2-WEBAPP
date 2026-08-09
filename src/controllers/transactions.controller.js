const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { toCsv, sendCsv } = require('../utils/csv');
const { buildWorkbook, sendXlsx } = require('../services/xlsx.service');
const { renderReceipt } = require('../services/pdf.service');
const { PAYMENT_METHODS } = require('../constants/orders');

/** Whitelisted sorts; anything else falls back to newest-first. */
const TRANSACTION_SORTS = {
  newest: '-createdAt',
  oldest: 'createdAt',
  amount_desc: '-amount',
  amount_asc: 'amount',
  method: 'method',
};

const transactionSort = (key) => TRANSACTION_SORTS[key] || TRANSACTION_SORTS.newest;

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
      .sort(transactionSort(req.query.sort))
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

/**
 * GET /api/transactions/export.xlsx — the same rows as the CSV, but branded
 * and with the sheet locked so the figures aren't casually edited before
 * being passed on. The CSV endpoint is unchanged for raw analysis.
 */
const exportXlsx = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  const transactions = await Transaction.find(filter)
    .sort('-createdAt')
    .limit(5000)
    .populate('receivedBy', 'firstName lastName');

  const describe = [
    req.query.method ? `method: ${req.query.method}` : '',
    req.query.search ? `search: ${req.query.search}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const buffer = await buildWorkbook({
    title: 'Transactions',
    subtitle: describe || 'all payments',
    headers: ['Date', 'Order Number', 'Method', 'Amount', 'Tendered', 'Change', 'Received By'],
    columns: [
      { width: 20 },
      { width: 22 },
      { width: 12 },
      { width: 14, numFmt: '#,##0.00' },
      { width: 14, numFmt: '#,##0.00' },
      { width: 12, numFmt: '#,##0.00' },
      { width: 24 },
    ],
    rows: transactions.map((t) => [
      t.createdAt.toISOString().replace('T', ' ').slice(0, 19),
      t.orderNumber,
      t.method,
      t.amount,
      t.amountTendered,
      t.change,
      t.receivedBy ? `${t.receivedBy.firstName} ${t.receivedBy.lastName}` : '',
    ]),
  });

  sendXlsx(res, 'transactions', buffer);
});

/**
 * GET /api/transactions/:id/receipt.pdf — the receipt for a completed sale.
 *
 * Rendered from the transaction and its order, both of which are settled
 * facts by the time a receipt exists. Admin and cashier reach this same
 * endpoint and get the same bytes: there is no per-role variant to drift,
 * and nothing cached that could disagree with the record.
 */
const receiptPdf = asyncHandler(async (req, res) => {
  const transaction = await Transaction.findById(req.params.id)
    .populate('receivedBy', 'firstName lastName')
    .populate('order');

  if (!transaction) throw new ApiError(404, 'Transaction not found.');
  if (!transaction.order) {
    throw new ApiError(404, 'The order behind this transaction is no longer available.');
  }

  await transaction.ensureReceiptNumber();

  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const pdf = await renderReceipt(transaction.order, transaction, { appUrl });

  res.setHeader('Content-Type', 'application/pdf');
  // Inline so the browser opens it for reading; the viewer's own Save button
  // is the download path, and the filename carries through either way.
  res.setHeader('Content-Disposition', `inline; filename="receipt-${transaction.receiptNumber}.pdf"`);
  res.send(pdf);
});

module.exports = { list, exportCsv, exportXlsx, receiptPdf };
