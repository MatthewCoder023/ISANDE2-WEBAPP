const express = require('express');

const reportsController = require('../controllers/reports.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');

const router = express.Router();

// Financial and inventory reporting is admin-only.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/sales', reportsController.sales);
router.get('/sales/export', reportsController.exportSales);
router.get('/inventory', reportsController.inventory);

module.exports = router;
