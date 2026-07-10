const express = require('express');

const transactionsController = require('../controllers/transactions.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.CASHIER, ROLES.ADMIN));

router.get('/', transactionsController.list);
router.get('/export', transactionsController.exportCsv);

module.exports = router;
