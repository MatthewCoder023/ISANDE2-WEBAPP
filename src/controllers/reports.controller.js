const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');
const Setting = require('../models/Setting');
const { toSectionedCsv, sendCsv } = require('../utils/csv');
const { ORDER_STATUS } = require('../constants/orders');

/**
 * Reads YYYY-MM-DD as a date on *this* calendar, not UTC.
 * `new Date('2026-03-01')` is UTC midnight, which in Manila is 8am on the
 * 1st — so asking for March would quietly have started on 28 February.
 */
function parseLocalDate(value) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!parts) return null;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** YYYY-MM-DD in local time, for labels and filenames. */
const localDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

/**
 * Resolves the reporting window. An explicit from/to wins — that is how you
 * answer "how did March go?" — and otherwise it falls back to the trailing
 * N days the page has always used, so existing links keep working.
 */
function resolveWindow(query) {
  const from = parseLocalDate(query.from);
  const to = parseLocalDate(query.to);

  if (from && to && from <= to) {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    // Inclusive of both endpoints: 1–31 March is 31 days, not 32.
    const days = Math.round((to - from) / 86400000);
    return { since: from, until: to, days };
  }

  const days = Math.min(Math.max(parseInt(query.days, 10) || 30, 7), 365);
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);
  const until = new Date();
  until.setHours(23, 59, 59, 999);
  return { since, until, days };
}

/**
 * GET /api/reports/sales?days=30 or ?from=&to= — admin sales analytics.
 * Money numbers come from Transactions (actual payments received);
 * product/category breakdowns come from completed orders' snapshots.
 */
const sales = asyncHandler(async (req, res) => {
  const { since, until, days } = resolveWindow(req.query);
  const window = { $gte: since, $lte: until };

  const [revenueByDay, totalsAgg, byMethod, topProducts, byCategory, newCustomers] =
    await Promise.all([
      Transaction.aggregate([
        { $match: { createdAt: window } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$amount' },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: window } },
        { $group: { _id: null, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: window } },
        { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
      ]),
      Order.aggregate([
        { $match: { status: ORDER_STATUS.COMPLETED, completedAt: window } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            sku: { $first: '$items.sku' },
            unitsSold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
        // The catalogue's colour and finish, so the report can render each
        // row in the paint it actually sold (display only — the money above
        // still comes from the order's own snapshot).
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        {
          $addFields: {
            colorHex: { $first: '$productDoc.color.hex' },
            finish: { $first: '$productDoc.finish' },
          },
        },
        { $project: { productDoc: 0 } },
      ]),
      Order.aggregate([
        { $match: { status: ORDER_STATUS.COMPLETED, completedAt: window } },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.product',
            foreignField: '_id',
            as: 'productDoc',
          },
        },
        {
          $group: {
            _id: { $ifNull: [{ $first: '$productDoc.category' }, 'other'] },
            unitsSold: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
          },
        },
        { $sort: { revenue: -1 } },
      ]),
      User.countDocuments({ role: ROLES.CLIENT, createdAt: window }),
    ]);

  const totals = totalsAgg[0] || { revenue: 0, transactions: 0 };

  res.json({
    success: true,
    data: {
      days,
      since,
      until,
      range: { from: localDay(since), to: localDay(until) },
      totals: {
        revenue: totals.revenue,
        transactions: totals.transactions,
        averageSale: totals.transactions
          ? Math.round((totals.revenue / totals.transactions) * 100) / 100
          : 0,
        newCustomers,
      },
      revenueByDay,
      byMethod,
      topProducts,
      byCategory,
    },
  });
});

/**
 * GET /api/reports/sales/export — the report on screen, as a document.
 * Shares resolveWindow with the JSON endpoint so the export always covers
 * exactly the window the admin is looking at.
 */
const exportSales = asyncHandler(async (req, res) => {
  const { since, until, days } = resolveWindow(req.query);
  const window = { $gte: since, $lte: until };
  const settings = await Setting.get();

  const [totalsAgg, byMethod, topProducts, byCategory] = await Promise.all([
    Transaction.aggregate([
      { $match: { createdAt: window } },
      { $group: { _id: null, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { createdAt: window } },
      { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    Order.aggregate([
      { $match: { status: ORDER_STATUS.COMPLETED, completedAt: window } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          sku: { $first: '$items.sku' },
          unitsSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
    Order.aggregate([
      { $match: { status: ORDER_STATUS.COMPLETED, completedAt: window } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      {
        $group: {
          _id: { $ifNull: [{ $first: '$productDoc.category' }, 'other'] },
          unitsSold: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
  ]);

  const totals = totalsAgg[0] || { revenue: 0, transactions: 0 };
  const day = localDay;

  const csv = toSectionedCsv([
    {
      title: 'Sales Report',
      rows: [
        ['Shop', settings.shopName],
        ['Period', `${day(since)} to ${day(until)} (${days} days)`],
        ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
      ],
    },
    {
      title: 'Totals',
      rows: [
        ['Revenue', totals.revenue],
        ['Transactions', totals.transactions],
        [
          'Average Sale',
          totals.transactions
            ? Math.round((totals.revenue / totals.transactions) * 100) / 100
            : 0,
        ],
      ],
    },
    {
      title: 'By Payment Method',
      headers: ['Method', 'Count', 'Amount'],
      rows: byMethod.map((m) => [m._id, m.count, m.amount]),
    },
    {
      title: 'Top Products',
      headers: ['Product', 'SKU', 'Units Sold', 'Revenue'],
      rows: topProducts.map((p) => [p.name, p.sku, p.unitsSold, p.revenue]),
    },
    {
      title: 'By Category',
      headers: ['Category', 'Units Sold', 'Revenue'],
      rows: byCategory.map((c) => [c._id, c.unitsSold, c.revenue]),
    },
  ]);

  sendCsv(res, `sales-${day(since)}-to-${day(until)}`, csv);
});

/** GET /api/reports/inventory — stock position right now. */
const inventory = asyncHandler(async (req, res) => {
  // Custom mixes are one-off jobs, not shelf stock to reorder.
  const catalogue = { isActive: true, isCustom: { $ne: true } };

  const [byCategory, lowStock] = await Promise.all([
    Product.aggregate([
      { $match: catalogue },
      {
        $group: {
          _id: '$category',
          skus: { $sum: 1 },
          units: { $sum: '$stock.quantity' },
          value: { $sum: { $multiply: ['$price', '$stock.quantity'] } },
        },
      },
      { $sort: { value: -1 } },
    ]),
    // quantity <= threshold covers both low-stock and out-of-stock.
    Product.find({
      ...catalogue,
      $expr: { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
    })
      .sort('stock.quantity')
      .limit(10),
  ]);

  const totals = byCategory.reduce(
    (acc, c) => ({
      skus: acc.skus + c.skus,
      units: acc.units + c.units,
      value: acc.value + c.value,
    }),
    { skus: 0, units: 0, value: 0 }
  );

  res.json({ success: true, data: { byCategory, totals, lowStock } });
});

module.exports = { sales, exportSales, inventory };
