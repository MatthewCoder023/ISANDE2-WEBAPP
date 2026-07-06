const { body } = require('express-validator');
const { ALL_ROLES } = require('../constants/roles');

const passwordRules = (field = 'password') => [
  body(field)
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[a-zA-Z]/).withMessage('Password must contain at least one letter.')
    .matches(/\d/).withMessage('Password must contain at least one number.'),
];

const createUserRules = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required.')
    .isLength({ max: 50 }).withMessage('First name must be 50 characters or fewer.'),
  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required.')
    .isLength({ max: 50 }).withMessage('Last name must be 50 characters or fewer.'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please provide a valid email address.')
    .normalizeEmail(),
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 7, max: 20 }).withMessage('Please provide a valid phone number.'),
  body('role')
    .isIn(ALL_ROLES).withMessage('Please choose a valid role.'),
  ...passwordRules(),
];

/** Email is immutable (it's the login identity); password has its own endpoint. */
const updateUserRules = [
  body('firstName')
    .optional()
    .trim()
    .notEmpty().withMessage('First name cannot be empty.')
    .isLength({ max: 50 }).withMessage('First name must be 50 characters or fewer.'),
  body('lastName')
    .optional()
    .trim()
    .notEmpty().withMessage('Last name cannot be empty.')
    .isLength({ max: 50 }).withMessage('Last name must be 50 characters or fewer.'),
  body('phone')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 20 }).withMessage('Please provide a valid phone number.'),
  body('role')
    .optional()
    .isIn(ALL_ROLES).withMessage('Please choose a valid role.'),
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be true or false.')
    .toBoolean(),
];

const resetPasswordRules = [...passwordRules()];

module.exports = { createUserRules, updateUserRules, resetPasswordRules };
