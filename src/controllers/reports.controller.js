const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');
const Setting = require('../models/Setting');
const { ORDER_STATUS } = require('../constants/orders');
const { renderReportPdf } = require('../services/pdf.service');

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

  /**
   * The window of equal length immediately before this one. A KPI on its own
   * is a number; against the period before it, it's a direction. Equal length
   * matters — comparing 7 days to 30 would make every figure look like a
   * collapse.
   */
  const priorUntil = new Date(since.getTime() - 1);
  const priorSince = new Date(priorUntil.getTime() - (until.getTime() - since.getTime()));
  const priorWindow = { $gte: priorSince, $lte: priorUntil };

  const [
    revenueByDay,
    totalsAgg,
    byMethod,
    topProducts,
    byCategory,
    newCustomers,
    priorTotalsAgg,
    priorNewCustomers,
  ] = await Promise.all([
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
      Transaction.aggregate([
        { $match: { createdAt: priorWindow } },
        { $group: { _id: null, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } },
      ]),
      User.countDocuments({ role: ROLES.CLIENT, createdAt: priorWindow }),
    ]);

  const totals = totalsAgg[0] || { revenue: 0, transactions: 0 };
  const prior = priorTotalsAgg[0] || { revenue: 0, transactions: 0 };
  const mean = (revenue, count) => (count ? Math.round((revenue / count) * 100) / 100 : 0);

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
        averageSale: mean(totals.revenue, totals.transactions),
        newCustomers,
      },
      // The same figures for the equal-length window immediately before.
      previous: {
        from: localDay(priorSince),
        to: localDay(priorUntil),
        revenue: prior.revenue,
        transactions: prior.transactions,
        averageSale: mean(prior.revenue, prior.transactions),
        newCustomers: priorNewCustomers,
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
  const filenameBase = `sales-${day(since)}-to-${day(until)}`;

  const sections = [
    {
      title: 'Totals',
      type: 'table',
      columns: [
        { label: 'Metric', width: 220, align: 'left' },
        { label: 'Value', width: 220, align: 'right' },
      ],
      rows: [
        ['Revenue', 'Php ' + totals.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
        ['Transactions', totals.transactions],
        ['Average Sale', 'Php ' + (totals.transactions ? Math.round((totals.revenue / totals.transactions) * 100) / 100 : 0)
          .toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
      ],
    },
    {
      title: 'By Payment Method',
      type: 'table',
      columns: [
        { label: 'Method', width: 220, align: 'left' },
        { label: 'Payments', width: 90, align: 'right' },
        { label: 'Amount', width: 130, align: 'right' },
      ],
      rows: byMethod.map((m) => [m._id, m.count, 'Php ' + 
        m.amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]),
    },
    {
      title: 'Top Products',
      type: 'table',
      columns: [
        { label: 'Product', width: 175, align: 'left' },
        { label: 'SKU', width: 115, align: 'left' },
        { label: 'Units', width: 40, align: 'right' },
        { label: 'Revenue', width: 130, align: 'right' },
      ],
      rows: topProducts.map((p) => [p.name, p.sku, p.unitsSold, 'Php ' + 
        p.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]),
    },
    {
      title: 'By Category',
      type: 'table',
      columns: [
        { label: 'Category', width: 230, align: 'left' },
        { label: 'Units', width: 90, align: 'right' },
        { label: 'Revenue', width: 130, align: 'right' },
      ],
      rows: byCategory.map((c) => [c._id, c.unitsSold, 'Php ' + 
        c.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]),
    },
  ];

  const pdf = await renderReportPdf({
    title: 'Sales Report',
    scope: `From ${day(since)} to ${day(until)} (${days} days)`,
    sections,
    settings,
    fileName: filenameBase,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filenameBase}.pdf"`);
  res.send(pdf);
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

const exportInventory = asyncHandler(async (req, res) => {
  const catalogue = { isActive: true, isCustom: { $ne: true } };
  const settings = await Setting.get();

  const [byCategory, lowStock, inventoryItems] = await Promise.all([
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
    Product.find({
      ...catalogue,
      $expr: { $lte: ['$stock.quantity', '$stock.lowStockThreshold'] },
    })
      .sort('stock.quantity')
      .limit(10),
    Product.find(catalogue)
      .sort('sku')
      .select('sku name category color finish size price stock.quantity stock.lowStockThreshold isActive')
      .lean(),
  ]);

  const formatCurrency = (value) =>
    `Php ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const sections = [
    {
      title: 'Inventory by Category',
      type: 'table',
      columns: [
        { label: 'Category', width: 200, align: 'left' },
        { label: 'SKUs', width: 60, align: 'right' },
        { label: 'Units', width: 70, align: 'right' },
        { label: 'Value', width: 95, align: 'right', type: 'currency' },
      ],
      rows: byCategory.map((c) => [c._id || 'Other', String(c.skus), String(c.units), c.value]),
    },
    {
      title: 'Items that need restocking',
      type: 'table',
      columns: [
        { label: 'Item', width: 220, align: 'left' },
        { label: 'SKU', width: 90, align: 'left' },
        { label: 'On Hand', width: 70, align: 'right', type: 'number' },
      { label: 'Low Stock Threshold', width: 70, align: 'right', type: 'number' },
      ],
      rows: lowStock.map((product) => [
        product.name,
        product.sku,
        product.stock?.quantity ?? 0,
        product.stock?.lowStockThreshold ?? 0,
      ]),
    },
    {
      title: 'Inventory Master List',
      pageBreakBefore: true,
      type: 'table',
      columns: [
        { label: 'Item name (SKU)', width: 110, align: 'left' },
        { label: 'Category', width: 50, align: 'left' },
        { label: 'Color (Hex value)', width: 60, align: 'left' },
        { label: 'Finish', width: 55, align: 'left' },
        { label: 'Size', width: 30, align: 'left' },
        { label: 'Price (in PHP)', width: 55, align: 'right', type: 'currencySpecial' },
        { label: 'Stock', width: 30, align: 'right', type: 'number' },
        { label: 'Low Stock', width: 45, align: 'right', type: 'number' },
        { label: 'Stock Value (in PHP)', width: 60, align: 'right', type: 'currencySpecial' },
        { label: 'Status', width: 40, align: 'left' },
      ],
      rows: inventoryItems.map((product) => [
        `${product.name}\n(${product.sku})`,
        product.category || '—',
        product.color?.name
          ? `${product.color.name} (${product.color.hex || '—'})`
          : '—',
        product.finish || '—',
        product.size || '—',
        product.price || 0,
        product.stock?.quantity ?? 0,
        product.stock?.lowStockThreshold ?? 0,
        (product.price || 0) * (product.stock?.quantity ?? 0),
        product.isActive ? 'Active' : 'Archived',
      ]),
    },
  ];

  const now = new Date();
  const timestamp = `${localDay(now)}-${String(now.getHours()).padStart(2, '0')}-${String(
    now.getMinutes()
  ).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const filenameBase = `inventory-report-${timestamp}`;

  const pdf = await renderReportPdf({
    title: 'Inventory Report',
    scope: 'Current stock position',
    sections,
    settings,
    fileName: filenameBase,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filenameBase}.pdf"`);
  res.send(pdf);
});

module.exports = { sales, exportSales, inventory, exportInventory };
