const express = require('express');

const ordersController = require('../controllers/orders.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadProof } = require('../middleware/upload');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const {
  placeOrderRules,
  walkInSaleRules,
  completeOrderRules,
  rejectPaymentRules,
} = require('../validators/orders.validators');

const router = express.Router();

const ORDER_ROLES = [ROLES.CLIENT, ROLES.CASHIER, ROLES.ADMIN];
const STAFF = [ROLES.CASHIER, ROLES.ADMIN];

router.use(requireAuth);

// Reads are role-shaped in the controller (clients only ever see their own).
router.get('/', requireRole(...ORDER_ROLES), ordersController.list);
router.get('/stats', requireRole(...ORDER_ROLES), ordersController.stats);
router.get('/:id', requireRole(...ORDER_ROLES), ordersController.getById);
router.get('/:id/proof', requireRole(...ORDER_ROLES), ordersController.getProof);

// Checkout: place, then settle payment (customer actions).
router.post('/', requireRole(ROLES.CLIENT), placeOrderRules, validate, ordersController.placeOrder);
router.post('/:id/payment-method', requireRole(ROLES.CLIENT), ordersController.chooseCashOnPickup);
router.post('/:id/proof', requireRole(ROLES.CLIENT), uploadProof, ordersController.uploadProof);

// POS.
router.post('/walk-in', requireRole(...STAFF), walkInSaleRules, validate, ordersController.walkInSale);

// Fulfilment workflow (staff).
router.post('/:id/verify-payment', requireRole(...STAFF), ordersController.verifyPayment);
router.post('/:id/reject-payment', requireRole(...STAFF), rejectPaymentRules, validate, ordersController.rejectPayment);
router.post('/:id/prepare', requireRole(...STAFF), ordersController.prepare);
router.post('/:id/ready', requireRole(...STAFF), ordersController.markReady);
router.post('/:id/complete', requireRole(...STAFF), completeOrderRules, validate, ordersController.complete);
router.post('/:id/cancel', requireRole(...ORDER_ROLES), ordersController.cancel);

module.exports = router;
