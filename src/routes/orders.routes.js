const express = require('express');

const ordersController = require('../controllers/orders.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const {
  placeOrderRules,
  walkInSaleRules,
  completeOrderRules,
} = require('../validators/orders.validators');

const router = express.Router();

const ORDER_ROLES = [ROLES.CLIENT, ROLES.CASHIER, ROLES.ADMIN];
const STAFF = [ROLES.CASHIER, ROLES.ADMIN];

router.use(requireAuth);

// Reads are role-shaped in the controller (clients only ever see their own).
router.get('/', requireRole(...ORDER_ROLES), ordersController.list);
router.get('/stats', requireRole(...ORDER_ROLES), ordersController.stats);
router.get('/:id', requireRole(...ORDER_ROLES), ordersController.getById);

// Online ordering is a customer action; POS sales are a staff action.
router.post('/', requireRole(ROLES.CLIENT), placeOrderRules, validate, ordersController.placeOrder);
router.post('/walk-in', requireRole(...STAFF), walkInSaleRules, validate, ordersController.walkInSale);

// Status transitions.
router.post('/:id/ready', requireRole(...STAFF), ordersController.markReady);
router.post('/:id/complete', requireRole(...STAFF), completeOrderRules, validate, ordersController.complete);
router.post('/:id/cancel', requireRole(...ORDER_ROLES), ordersController.cancel);

module.exports = router;
