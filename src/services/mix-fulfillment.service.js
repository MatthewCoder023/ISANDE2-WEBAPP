const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const Setting = require('../models/Setting');
const { MOVEMENT_TYPES, PRODUCT_CATEGORIES } = require('../constants/products');

/**
 * Bridges the mixing workshop to the shop.
 *
 * A MixRequest has no price and no stock, so it can never enter an Order —
 * the order engine prices strictly from catalogue Products. Rather than
 * teaching orders about mixes (which would mean rewriting pricing, stock
 * reservation, invoices and reports), completing a mix *publishes* it as a
 * real Product reserved for that one customer. Everything downstream —
 * cart, checkout, stock, invoice, CSV, reports — then works untouched.
 */

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Quote for one unit of a mix: the chosen base paint's price (or the
 * configured default when the customer let the mixer pick) plus the
 * hand-mixing surcharge.
 */
async function quoteUnitPrice(request) {
  const settings = await Setting.get();
  const basePrice = request.product?.price ?? settings.customMixBasePrice;
  return round2(basePrice + settings.customMixSurcharge);
}

/** Falls back to a readable name when the customer didn't name the colour. */
function productName(request) {
  const colourName = request.targetColor?.name?.trim();
  return colourName ? `${colourName} (Custom Mix)` : `Custom Mix ${request.requestNumber}`;
}

/**
 * Publishes a completed mix as a catalogue product reserved for its
 * customer, and records the mixed quantity in the stock audit trail exactly
 * as a normal product's opening stock would be. Returns the Product, or
 * null for staff-created walk-in jobs that have no customer account to
 * reserve it for.
 */
async function publishMixProduct(request, { unitPrice, actorId }) {
  if (!request.customer) return null;

  // The base paint decides the shape of the product; without one the mix is
  // a general interior paint, which is what the shop mixes by default.
  const base = request.product && request.product.category ? request.product : null;
  const category = base?.category || PRODUCT_CATEGORIES.INTERIOR;
  const quantity = request.quantity || 1;

  const product = await Product.create({
    name: productName(request),
    sku: await Product.generateSku(category),
    description:
      `Hand-mixed to order for request ${request.requestNumber}.` +
      (request.mixerNotes ? ` ${request.mixerNotes}` : ''),
    category,
    finish: base?.finish || 'satin',
    size: base?.size || '1L',
    color: {
      name: request.targetColor?.name || 'Custom colour',
      hex: request.targetColor.hex,
    },
    price: unitPrice,
    stock: {
      quantity,
      // One-off batch: it is never "low", it simply runs out once bought.
      lowStockThreshold: 0,
    },
    isCustom: true,
    customFor: request.customer,
  });

  await StockMovement.create({
    product: product._id,
    type: MOVEMENT_TYPES.INITIAL,
    quantity,
    quantityAfter: quantity,
    reason: `Mixed for request ${request.requestNumber}`,
    performedBy: actorId || null,
  });

  return product;
}

module.exports = { quoteUnitPrice, publishMixProduct };
