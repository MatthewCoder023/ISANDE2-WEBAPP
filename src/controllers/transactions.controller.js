const Transaction = require('../models/Transaction');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { renderReceipt, renderReportPdf } = require('../services/pdf.service');
const { PAYMENT_METHODS } = require('../constants/orders');
const Setting = require('../models/Setting');

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

/** GET /api/transactions/export — the payment log as a PDF download. */
const exportPdf = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query);
  const transactions = await Transaction.find(filter)
    .sort('-createdAt')
    .limit(5000)
    .populate('receivedBy', 'firstName lastName');

  const settings = await Setting.get();
  const describe = [
    req.query.method ? `method: ${req.query.method}` : '',
    req.query.search ? `search: ${req.query.search}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const filenameBase = `transaction-log-${timestamp}`;

  const pdf = await renderReportPdf({
    title: 'Transaction Log',
    scope: describe || 'All Payments',
    sections: [
      {
        title: 'Payments',
        type: 'table',
        columns: [
          { label: 'Date', width: 115, align: 'left' },
          { label: 'Order number', width: 105, align: 'left' },
          { label: 'Method', width: 80, align: 'left' },
          { label: 'Amount', width: 90, align: 'right', type: 'currency' },
          { label: 'Received By', width: 105, align: 'left' },
        ],
        rows: transactions.map((t) => [
          t.createdAt.toLocaleString('sv-SE', { timeZone: 'Asia/Manila' }).slice(0, 19),
          t.orderNumber,
          t.method,
          t.amount,
          t.receivedBy ? `${t.receivedBy.firstName} ${t.receivedBy.lastName}` : '—',
        ]),
      },
    ],
    settings,
    fileName: filenameBase,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filenameBase}.pdf"`);
  res.send(pdf);
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

module.exports = { list, exportPdf, receiptPdf };
