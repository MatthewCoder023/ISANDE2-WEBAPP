const { body } = require('express-validator');
const { PAYMENT_METHODS } = require('../constants/orders');

const itemRules = [
  body('items')
    .isArray({ min: 1 }).withMessage('Your order must contain at least one item.'),
  body('items.*.productId')
    .isMongoId().withMessage('Invalid product in order.'),
  body('items.*.quantity')
    .isInt({ min: 1, max: 999 }).withMessage('Quantity must be between 1 and 999.')
    .toInt(),
];

const placeOrderRules = [
  ...itemRules,
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 }).withMessage('Notes must be 300 characters or fewer.'),
];

const paymentRules = (prefix) => [
  body(`${prefix}method`)
    .isIn(PAYMENT_METHODS).withMessage('Please choose a valid payment method.'),
  body(`${prefix}amountTendered`)
    .optional({ values: 'null' })
    .isFloat({ min: 0 }).withMessage('Amount tendered must be 0 or more.')
    .toFloat(),
];

const walkInSaleRules = [
  ...itemRules,
  body('customerName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 }).withMessage('Customer name must be 80 characters or fewer.'),
  ...paymentRules('payment.'),
];

/**
 * Completion only carries payment fields when the order is still unpaid
 * (cash on pickup / walk-in); verified-GCash orders send an empty body.
 */
const completeOrderRules = [
  body('method')
    .optional({ values: 'falsy' })
    .isIn(PAYMENT_METHODS).withMessage('Please choose a valid payment method.'),
  body('amountTendered')
    .optional({ values: 'null' })
    .isFloat({ min: 0 }).withMessage('Amount tendered must be 0 or more.')
    .toFloat(),
];

const rejectPaymentRules = [
  body('reason')
    .trim()
    .notEmpty().withMessage('Tell the customer why the proof was rejected.')
    .isLength({ max: 200 }).withMessage('Reason must be 200 characters or fewer.'),
];

module.exports = { placeOrderRules, walkInSaleRules, completeOrderRules, rejectPaymentRules };
