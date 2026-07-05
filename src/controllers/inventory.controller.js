const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const inventoryService = require('../services/inventory.service');

/** POST /api/products/:id/stock — admin only. */
const adjustStock = asyncHandler(async (req, res) => {
  const { type, quantity, reason } = req.body;

  const { product, movement } = await inventoryService.adjustStock({
    productId: req.params.id,
    type,
    quantity,
    reason,
    userId: req.user._id,
  });

  res.json({
    success: true,
    message: 'Stock updated successfully.',
    data: { product: product.toJSON(), movement: movement.toJSON() },
  });
});

/** GET /api/products/:id/movements — admin only, newest first. */
const listMovements = asyncHandler(async (req, res) => {
  const productExists = await Product.exists({ _id: req.params.id });
  if (!productExists) throw new ApiError(404, 'Product not found.');

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

  const [movements, total] = await Promise.all([
    StockMovement.find({ product: req.params.id })
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('performedBy', 'firstName lastName'),
    StockMovement.countDocuments({ product: req.params.id }),
  ]);

  res.json({
    success: true,
    data: {
      movements,
      pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
    },
  });
});

module.exports = { adjustStock, listMovements };
