const express = require('express');
const { isValidObjectId } = require('mongoose');
const rateLimit = require('express-rate-limit');

const ordersController = require('../controllers/orders.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadProof, verifyProofImage } = require('../middleware/upload');
const ApiError = require('../utils/ApiError');
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

// Runs before multer on the proof route: a malformed :id must be rejected
// before any file ever touches the disk.
function checkOrderId(req, res, next) {
  if (!isValidObjectId(req.params.id)) {
    return next(new ApiError(400, 'Invalid identifier format.'));
  }
  next();
}

// Uploads write to disk before any order check — cap the rate so the
// endpoint cannot be used to fill storage.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many uploads. Please try again in a few minutes.',
  },
});

/**
 * Document verification is public by design — whoever is holding a printed
 * invoice must be able to check it, and the code is an unguessable HMAC.
 * Registered before the auth gate below.
 */
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
});

router.get('/verify', verifyLimiter, ordersController.verifyDocument);

router.use(requireAuth);

// Reads are role-shaped in the controller (clients only ever see their own).
router.get('/', requireRole(...ORDER_ROLES), ordersController.list);
router.get('/stats', requireRole(...ORDER_ROLES), ordersController.stats);
router.get('/:id', requireRole(...ORDER_ROLES), ordersController.getById);
router.get('/:id/proof', requireRole(...ORDER_ROLES), ordersController.getProof);
router.get('/:id/invoice.pdf', requireRole(...ORDER_ROLES), checkOrderId, ordersController.invoicePdf);
router.get('/:id/export.csv', requireRole(...ORDER_ROLES), checkOrderId, ordersController.exportOrderCsv);

// Checkout: place, then settle payment (customer actions).
router.post('/', requireRole(ROLES.CLIENT), placeOrderRules, validate, ordersController.placeOrder);
router.post('/:id/payment-method', requireRole(ROLES.CLIENT), ordersController.chooseCashOnPickup);
router.post('/:id/proof', requireRole(ROLES.CLIENT), uploadLimiter, checkOrderId, uploadProof, verifyProofImage, ordersController.uploadProof);

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
