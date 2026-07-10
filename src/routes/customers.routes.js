const express = require('express');

const customersController = require('../controllers/customers.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

const router = express.Router();

// Customer records are a cashier responsibility (admin has full access).
router.use(requireAuth, requireRole(ROLES.CASHIER, ROLES.ADMIN));

router.get('/', customersController.list);

module.exports = router;
