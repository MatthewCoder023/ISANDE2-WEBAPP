const express = require('express');
const { param } = require('express-validator');

const transactionsController = require('../controllers/transactions.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.CASHIER, ROLES.ADMIN));

router.get('/', transactionsController.list);
router.get('/export', transactionsController.exportCsv);
router.get('/export.xlsx', transactionsController.exportXlsx);

// The receipt for one sale. Same document for cashier and admin alike —
// the role gate above is the only access rule either of them meets.
router.get(
  '/:id/receipt.pdf',
  param('id').isMongoId().withMessage('Invalid transaction id.'),
  validate,
  transactionsController.receiptPdf
);

module.exports = router;
