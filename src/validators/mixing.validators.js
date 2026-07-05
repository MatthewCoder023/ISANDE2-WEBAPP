const { body } = require('express-validator');
const { FORMULA_UNITS } = require('../constants/mixing');

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const createMixRequestRules = [
  body('targetColor.hex')
    .matches(HEX_COLOR_REGEX).withMessage('Pick a color first (hex value like #A1B2C3).'),
  body('targetColor.name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 50 }).withMessage('Color name must be 50 characters or fewer.'),
  body('productId')
    .optional({ values: 'falsy' })
    .isMongoId().withMessage('Invalid base product.'),
  body('quantity')
    .optional()
    .isInt({ min: 1, max: 99 }).withMessage('Quantity must be between 1 and 99 cans.')
    .toInt(),
  body('customerName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 }).withMessage('Customer name must be 80 characters or fewer.'),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 }).withMessage('Notes must be 300 characters or fewer.'),
];

const formulaComponentRules = (prefix) => [
  body(`${prefix}components`)
    .isArray({ min: 1 }).withMessage('Add at least one formula component.'),
  body(`${prefix}components.*.name`)
    .trim()
    .notEmpty().withMessage('Component name is required.')
    .isLength({ max: 50 }).withMessage('Component name must be 50 characters or fewer.'),
  body(`${prefix}components.*.amount`)
    .isFloat({ gt: 0 }).withMessage('Component amount must be greater than zero.')
    .toFloat(),
  body(`${prefix}components.*.unit`)
    .optional()
    .isIn(FORMULA_UNITS).withMessage('Invalid component unit.'),
];

const createFormulaRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Formula name is required.')
    .isLength({ max: 80 }).withMessage('Formula name must be 80 characters or fewer.'),
  body('colorHex')
    .matches(HEX_COLOR_REGEX).withMessage('Color must be a hex value like #A1B2C3.'),
  ...formulaComponentRules(''),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 }).withMessage('Notes must be 300 characters or fewer.'),
];

const updateFormulaRules = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Formula name cannot be empty.')
    .isLength({ max: 80 }).withMessage('Formula name must be 80 characters or fewer.'),
  body('colorHex')
    .optional()
    .matches(HEX_COLOR_REGEX).withMessage('Color must be a hex value like #A1B2C3.'),
  body('components')
    .optional()
    .isArray({ min: 1 }).withMessage('A formula needs at least one component.'),
  body('components.*.name')
    .optional()
    .trim()
    .notEmpty().withMessage('Component name is required.')
    .isLength({ max: 50 }).withMessage('Component name must be 50 characters or fewer.'),
  body('components.*.amount')
    .optional()
    .isFloat({ gt: 0 }).withMessage('Component amount must be greater than zero.')
    .toFloat(),
  body('components.*.unit')
    .optional()
    .isIn(FORMULA_UNITS).withMessage('Invalid component unit.'),
  body('notes')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 300 }).withMessage('Notes must be 300 characters or fewer.'),
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be true or false.')
    .toBoolean(),
];

const completeMixRules = [
  body('formulaId')
    .optional({ values: 'falsy' })
    .isMongoId().withMessage('Invalid formula.'),
  // A brand-new formula can be recorded as part of completing a mix.
  body('newFormula.name')
    .if(body('newFormula').exists({ values: 'falsy' }))
    .trim()
    .notEmpty().withMessage('Formula name is required.')
    .isLength({ max: 80 }).withMessage('Formula name must be 80 characters or fewer.'),
  body('newFormula.colorHex')
    .if(body('newFormula').exists({ values: 'falsy' }))
    .matches(HEX_COLOR_REGEX).withMessage('Color must be a hex value like #A1B2C3.'),
  body('newFormula.components')
    .if(body('newFormula').exists({ values: 'falsy' }))
    .isArray({ min: 1 }).withMessage('Add at least one formula component.'),
  body('newFormula.components.*.name')
    .trim()
    .notEmpty().withMessage('Component name is required.')
    .isLength({ max: 50 }).withMessage('Component name must be 50 characters or fewer.'),
  body('newFormula.components.*.amount')
    .isFloat({ gt: 0 }).withMessage('Component amount must be greater than zero.')
    .toFloat(),
  body('newFormula.components.*.unit')
    .optional()
    .isIn(FORMULA_UNITS).withMessage('Invalid component unit.'),
  body('mixerNotes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 }).withMessage('Notes must be 300 characters or fewer.'),
  body().custom((value) => {
    if (value.formulaId && value.newFormula) {
      throw new Error('Choose an existing formula or record a new one — not both.');
    }
    return true;
  }),
];

module.exports = {
  createMixRequestRules,
  createFormulaRules,
  updateFormulaRules,
  completeMixRules,
};
