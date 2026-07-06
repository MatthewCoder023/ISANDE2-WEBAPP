const express = require('express');
const { body } = require('express-validator');

const settingsController = require('../controllers/settings.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');

const router = express.Router();

const updateRules = [
  body('shopName').optional().trim().notEmpty().withMessage('Shop name cannot be empty.')
    .isLength({ max: 80 }).withMessage('Shop name must be 80 characters or fewer.'),
  body('addressLine').optional({ values: 'null' }).trim()
    .isLength({ max: 160 }).withMessage('Address must be 160 characters or fewer.'),
  body('phone').optional({ values: 'null' }).trim()
    .isLength({ max: 30 }).withMessage('Phone must be 30 characters or fewer.'),
  body('gcashNumber').optional().trim().notEmpty().withMessage('GCash number cannot be empty.')
    .isLength({ max: 30 }).withMessage('GCash number must be 30 characters or fewer.'),
  body('gcashName').optional().trim().notEmpty().withMessage('GCash account name cannot be empty.')
    .isLength({ max: 80 }).withMessage('GCash account name must be 80 characters or fewer.'),
  body('acceptOnlineOrders').optional().isBoolean().toBoolean(),
  body('defaultLowStockThreshold').optional()
    .isInt({ min: 0, max: 999 }).withMessage('Threshold must be a whole number between 0 and 999.')
    .toInt(),
];

router.get('/', requireAuth, settingsController.get);
router.patch('/', requireAuth, requireRole(ROLES.ADMIN), updateRules, validate, settingsController.update);

module.exports = router;
