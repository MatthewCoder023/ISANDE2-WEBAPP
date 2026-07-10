const express = require('express');

const productsController = require('../controllers/products.controller');
const inventoryController = require('../controllers/inventory.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const {
  createProductRules,
  updateProductRules,
  stockAdjustmentRules,
} = require('../validators/products.validators');

const router = express.Router();

// Everything below requires a session; catalog reads are open to all roles.
router.use(requireAuth);

router.get('/', productsController.list);
router.get('/stats', requireRole(ROLES.ADMIN), productsController.stats);
router.get('/match', productsController.matchByColor);
router.get('/export', requireRole(ROLES.ADMIN), productsController.exportCsv);
router.get('/:id', productsController.getById);

// Catalog management — admin only.
router.post('/', requireRole(ROLES.ADMIN), createProductRules, validate, productsController.create);
router.patch('/:id', requireRole(ROLES.ADMIN), updateProductRules, validate, productsController.update);
router.delete('/:id', requireRole(ROLES.ADMIN), productsController.archive);

// Inventory — admin only. All quantity changes go through /stock.
router.post('/:id/stock', requireRole(ROLES.ADMIN), stockAdjustmentRules, validate, inventoryController.adjustStock);
router.get('/:id/movements', requireRole(ROLES.ADMIN), inventoryController.listMovements);

module.exports = router;
