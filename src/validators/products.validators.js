const { body } = require('express-validator');
const { CATEGORY_VALUES, FINISHES, SIZES, MOVEMENT_TYPES } = require('../constants/products');

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const SKU_REGEX = /^[A-Za-z0-9-]{3,24}$/;

const createProductRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required.')
    .isLength({ max: 100 }).withMessage('Product name must be 100 characters or fewer.'),
  body('sku')
    .optional({ values: 'falsy' })
    .trim()
    .matches(SKU_REGEX).withMessage('SKU must be 3–24 letters, numbers, or dashes.'),
  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 }).withMessage('Description must be 500 characters or fewer.'),
  body('category')
    .isIn(CATEGORY_VALUES).withMessage('Please choose a valid category.'),
  body('finish')
    .optional({ values: 'falsy' })
    .isIn(FINISHES).withMessage('Please choose a valid finish.'),
  body('size')
    .optional({ values: 'falsy' })
    .isIn(SIZES).withMessage('Please choose a valid size.'),
  body('color.name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 50 }).withMessage('Color name must be 50 characters or fewer.'),
  body('color.hex')
    .optional({ values: 'falsy' })
    .matches(HEX_COLOR_REGEX).withMessage('Color must be a hex value like #A1B2C3.'),
  body('price')
    .isFloat({ min: 0 }).withMessage('Price must be 0 or more.')
    .toFloat(),
  body('stock.quantity')
    .optional()
    .isInt({ min: 0 }).withMessage('Initial stock must be a whole number, 0 or more.')
    .toInt(),
  body('stock.lowStockThreshold')
    .optional()
    .isInt({ min: 0 }).withMessage('Low-stock threshold must be a whole number, 0 or more.')
    .toInt(),
];

/**
 * Same fields as create, but everything is optional (PATCH semantics).
 * Deliberately excluded: sku (immutable once created) and stock.quantity
 * (must go through the stock endpoint so the audit trail stays complete).
 */
const updateProductRules = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Product name cannot be empty.')
    .isLength({ max: 100 }).withMessage('Product name must be 100 characters or fewer.'),
  body('description')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 500 }).withMessage('Description must be 500 characters or fewer.'),
  body('category')
    .optional()
    .isIn(CATEGORY_VALUES).withMessage('Please choose a valid category.'),
  body('finish')
    .optional({ values: 'null' })
    .custom((value) => value === '' || FINISHES.includes(value))
    .withMessage('Please choose a valid finish.'),
  body('size')
    .optional({ values: 'null' })
    .custom((value) => value === '' || SIZES.includes(value))
    .withMessage('Please choose a valid size.'),
  body('color.name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 50 }).withMessage('Color name must be 50 characters or fewer.'),
  body('color.hex')
    .optional({ values: 'falsy' })
    .matches(HEX_COLOR_REGEX).withMessage('Color must be a hex value like #A1B2C3.'),
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Price must be 0 or more.')
    .toFloat(),
  body('stock.lowStockThreshold')
    .optional()
    .isInt({ min: 0 }).withMessage('Low-stock threshold must be a whole number, 0 or more.')
    .toInt(),
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be true or false.')
    .toBoolean(),
];

/**
 * Corrections only.
 *
 * Restocking used to live here too. It moved to purchase orders, where an
 * increase in stock is backed by a supplier, a document and a delivery —
 * this endpoint no longer accepts it, so there is exactly one way for stock
 * to arrive and it leaves a paper trail.
 *
 * What remains is the case a purchase order cannot express: cans damaged in
 * the stockroom, a physical count disagreeing with the system. Those are
 * signed corrections and always need a reason.
 */
const stockAdjustmentRules = [
  body('type')
    .optional()
    .isIn([MOVEMENT_TYPES.ADJUSTMENT])
    .withMessage('Stock can only be corrected here. Use a purchase order to bring in new stock.'),
  body('quantity')
    .isInt().withMessage('Quantity must be a whole number.')
    .toInt()
    .custom((value) => {
      if (value === 0) throw new Error('Adjustment quantity cannot be zero.');
      return true;
    }),
  // Corrections change counts outside normal operations — always explain why.
  body('reason')
    .trim()
    .notEmpty().withMessage('Please provide a reason for the correction.'),
  body('reason')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 }).withMessage('Reason must be 200 characters or fewer.'),
];

module.exports = { createProductRules, updateProductRules, stockAdjustmentRules };
