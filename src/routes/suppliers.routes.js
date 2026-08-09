const express = require('express');
const { body, param } = require('express-validator');

const suppliersController = require('../controllers/suppliers.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');

const router = express.Router();

const supplierRules = (optional = false) => {
  const maybe = (chain) => (optional ? chain.optional() : chain);
  return [
    maybe(body('name').trim().notEmpty().withMessage('Supplier name is required.'))
      .isLength({ max: 100 })
      .withMessage('Supplier name must be 100 characters or fewer.'),
    body('contactPerson').optional({ values: 'null' }).trim().isLength({ max: 100 }),
    body('email')
      .optional({ values: 'falsy' })
      .trim()
      .isEmail()
      .withMessage('Enter a valid email address.')
      .normalizeEmail(),
    body('phone').optional({ values: 'null' }).trim().isLength({ max: 30 }),
    body('address').optional({ values: 'null' }).trim().isLength({ max: 200 }),
    body('paymentTerms').optional({ values: 'null' }).trim().isLength({ max: 80 }),
    body('notes').optional({ values: 'null' }).trim().isLength({ max: 300 }),
    body('isActive').optional().isBoolean().toBoolean(),
  ];
};

const idRule = [param('id').isMongoId().withMessage('Invalid supplier id.')];

// Procurement is the admin's remit; no other role reaches these.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', suppliersController.list);
router.post('/', supplierRules(), validate, suppliersController.create);
router.patch('/:id', idRule, supplierRules(true), validate, suppliersController.update);
router.delete('/:id', idRule, validate, suppliersController.deactivate);

module.exports = router;
