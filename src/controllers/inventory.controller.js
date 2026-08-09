const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const inventoryService = require('../services/inventory.service');
const { MOVEMENT_TYPES } = require('../constants/products');

/**
 * POST /api/products/:id/stock — admin only, corrections only.
 *
 * Deliveries come in through purchase orders, which carry a supplier and a
 * document. What is left for this endpoint is the discrepancy a purchase
 * order cannot describe: damage, loss, or a physical count that disagrees
 * with the system. The type is forced rather than taken from the request,
 * so no caller can quietly book a restock through the back door.
 */
const adjustStock = asyncHandler(async (req, res) => {
  const { quantity, reason } = req.body;

  const { product, movement } = await inventoryService.adjustStock({
    productId: req.params.id,
    type: MOVEMENT_TYPES.ADJUSTMENT,
    quantity,
    reason,
    userId: req.user._id,
  });

  res.json({
    success: true,
    message: 'Stock corrected.',
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
