const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../constants/roles');
const { ORDER_STATUS } = require('../constants/orders');

/**
 * GET /api/reports/sales?days=30 — admin sales analytics.
 * Money numbers come from Transactions (actual payments received);
 * product/category breakdowns come from completed orders' snapshots.
 */
const sales = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 365);
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const [revenueByDay, totalsAgg, byMethod, topProducts, byCategory, newCustomers] =
    await Promise.all([
      Transaction.aggregate([
        { $match: { createdAt: { $gte: since } } },
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
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: null, revenue: { $sum: '$amount' }, transactions: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
      ]),
      Order.aggregate([
        { $match: { status: ORDER_STATUS.COMPLETED, completedAt: { $gte: since } } },
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
      ]),
      Order.aggregate([
        { $match: { status: ORDER_STATUS.COMPLETED, completedAt: { $gte: since } } },
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
      User.countDocuments({ role: ROLES.CLIENT, createdAt: { $gte: since } }),
    ]);

  const totals = totalsAgg[0] || { revenue: 0, transactions: 0 };

  res.json({
    success: true,
    data: {
      days,
      since,
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

/** GET /api/reports/inventory — stock position right now. */
const inventory = asyncHandler(async (req, res) => {
  const [byCategory, lowStock] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true } },
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
      isActive: true,
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

module.exports = { sales, inventory };
