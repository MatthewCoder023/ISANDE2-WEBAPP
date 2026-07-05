const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const ApiError = require('../utils/ApiError');

/**
 * The single write path for stock quantities.
 *
 * The update is a conditional atomic $inc: when the delta is negative,
 * the filter requires enough stock, so concurrent requests can never
 * drive the quantity below zero (no transaction needed — local standalone
 * MongoDB doesn't support them, and this guard is sufficient).
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.type      MOVEMENT_TYPES value
 * @param {number} params.quantity  signed integer delta
 * @param {string} [params.reason]
 * @param {string} params.userId    who performed the change
 * @returns {{ product, movement }}
 */
async function adjustStock({ productId, type, quantity, reason = '', userId }) {
  const filter = { _id: productId };
  if (quantity < 0) {
    filter['stock.quantity'] = { $gte: -quantity };
  }

  const product = await Product.findOneAndUpdate(
    filter,
    { $inc: { 'stock.quantity': quantity } },
    { new: true }
  );

  if (!product) {
    const exists = await Product.exists({ _id: productId });
    if (!exists) throw new ApiError(404, 'Product not found.');
    throw new ApiError(409, 'Not enough stock for this adjustment.');
  }

  const movement = await StockMovement.create({
    product: product._id,
    type,
    quantity,
    quantityAfter: product.stock.quantity,
    reason,
    performedBy: userId,
  });

  return { product, movement };
}

module.exports = { adjustStock };
