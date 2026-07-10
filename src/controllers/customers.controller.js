const User = require('../models/User');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const escapeRegExp = require('../utils/escapeRegExp');
const { ROLES } = require('../constants/roles');
const { ORDER_STATUS } = require('../constants/orders');

/**
 * GET /api/customers — cashier/admin customer records: each customer
 * with their order count, completed spend, and last order date.
 */
const list = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const filter = { role: ROLES.CLIENT };
  if (req.query.search) {
    const pattern = new RegExp(escapeRegExp(req.query.search.trim()), 'i');
    filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }

  const [customers, total] = await Promise.all([
    User.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  // Order stats for just this page of customers.
  const ids = customers.map((c) => c._id);
  const orderStats = await Order.aggregate([
    { $match: { customer: { $in: ids } } },
    {
      $group: {
        _id: '$customer',
        orders: { $sum: 1 },
        spent: {
          $sum: { $cond: [{ $eq: ['$status', ORDER_STATUS.COMPLETED] }, '$total', 0] },
        },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ]);
  const statsById = new Map(orderStats.map((s) => [String(s._id), s]));

  res.json({
    success: true,
    data: {
      customers: customers.map((c) => {
        const stats = statsById.get(String(c._id)) || { orders: 0, spent: 0, lastOrderAt: null };
        return {
          ...c.toJSON(),
          orders: stats.orders,
          spent: stats.spent,
          lastOrderAt: stats.lastOrderAt,
        };
      }),
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

module.exports = { list };
