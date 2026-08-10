const express = require('express');
const { body, param } = require('express-validator');

const purchaseOrdersController = require('../controllers/purchase-orders.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const { PO_STATUS } = require('../constants/purchasing');

const router = express.Router();

const idRule = [param('id').isMongoId().withMessage('Invalid purchase order id.')];

const createRules = [
  body('supplierId').isMongoId().withMessage('Choose a supplier.'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Add at least one item to the purchase order.'),
  body('items.*.productId').isMongoId().withMessage('Invalid product on one of the lines.'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Order at least one unit of each item.')
    .toInt(),
  // The supplier's price, which the catalogue does not know. Optional: the
  // product's own price stands in as a starting figure.
  body('items.*.unitCost')
    .optional({ values: 'null' })
    .isFloat({ min: 0 })
    .withMessage('Unit cost cannot be negative.')
    .toFloat(),
  body('expectedDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid expected date.'),
  body('notes').optional({ values: 'null' }).trim().isLength({ max: 500 }),
  body('status')
    .optional()
    .isIn([PO_STATUS.DRAFT, PO_STATUS.ORDERED])
    .withMessage('A new purchase order can only be a draft or ordered.'),
];

const receiveRules = [
  body('items').isArray({ min: 1 }).withMessage('Confirm the received quantities.'),
  body('items.*.sku').trim().notEmpty().withMessage('Each line needs its SKU.'),
  body('items.*.quantityReceived')
    .isInt({ min: 0 })
    .withMessage('Received quantity must be a whole number, 0 or more.')
    .toInt(),
];

/**
 * The one procurement read a cashier gets, and it must be declared before
 * the admin gate below — both because the gate would otherwise catch it, and
 * because "/incoming" would otherwise be swallowed by the "/:id" route.
 *
 * It carries no costs or totals. Knowing a delivery is due on Thursday helps
 * at the counter; knowing what the shop paid for it is not the counter's
 * business, and keeping that out here is why this is a separate endpoint
 * rather than a relaxed guard on the purchase order list.
 */
router.get(
  '/incoming',
  requireAuth,
  requireRole(ROLES.CASHIER, ROLES.ADMIN),
  purchaseOrdersController.incoming
);

// Everything else about procurement is the admin's remit.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', purchaseOrdersController.list);
router.get('/stats', purchaseOrdersController.stats);
router.get('/:id', idRule, validate, purchaseOrdersController.detail);
router.get('/:id/document.pdf', idRule, validate, purchaseOrdersController.documentPdf);

router.post('/', createRules, validate, purchaseOrdersController.create);
router.post('/:id/order', idRule, validate, purchaseOrdersController.markOrdered);
router.post('/:id/receive', idRule, receiveRules, validate, purchaseOrdersController.receive);
router.post(
  '/:id/cancel',
  idRule,
  body('reason').optional({ values: 'null' }).trim().isLength({ max: 200 }),
  validate,
  purchaseOrdersController.cancel
);

module.exports = router;
