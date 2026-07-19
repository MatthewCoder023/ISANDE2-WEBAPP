const { body } = require('express-validator');

/**
 * The most common leaked passwords that also satisfy the basic
 * letter+number rule. Checked case-insensitively on every endpoint
 * that sets a password.
 */
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd',
  'p@ssw0rd', 'p4ssword', 'abc12345', 'abcd1234', 'qwerty12', 'qwerty123',
  'qwerty1234', 'qwertyuiop1', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx',
  'qazwsx123', 'asdf1234', 'zxcv1234', 'iloveyou1', 'iloveyou2',
  'welcome1', 'welcome12', 'welcome123', 'admin123', 'admin1234',
  'letmein1', 'letmein123', 'monkey123', 'dragon123', 'sunshine1',
  'princess1', 'football1', 'baseball1', 'superman1', 'batman123',
  'trustno1', 'master123', 'hello123', 'freedom1', 'whatever1',
  'changeme1', 'temp1234', 'test1234', 'user1234', 'pass1234',
  'password2025', 'password2026', 'flavor123', 'color123', 'paint123',
]);

const rejectCommonPassword = (value) => {
  if (COMMON_PASSWORDS.has(String(value).toLowerCase())) {
    throw new Error('This password is too common — please choose something harder to guess.');
  }
  return true;
};

const registerRules = [
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
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/[a-zA-Z]/).withMessage('Password must contain at least one letter.')
    .matches(/\d/).withMessage('Password must contain at least one number.')
    .custom(rejectCommonPassword),
];

const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please provide a valid email address.'),
  body('password')
    .notEmpty().withMessage('Password is required.'),
];

const updateProfileRules = [
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
];

const changePasswordRules = [
  body('currentPassword')
    .notEmpty().withMessage('Enter your current password.'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters.')
    .matches(/[a-zA-Z]/).withMessage('New password must contain at least one letter.')
    .matches(/\d/).withMessage('New password must contain at least one number.')
    .custom(rejectCommonPassword)
    .custom((value, { req }) => {
      if (value === req.body.currentPassword) {
        throw new Error('New password must be different from the current one.');
      }
      return true;
    }),
];

const forgotPasswordRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Please provide a valid email address.'),
];

const resetPasswordRules = [
  body('token')
    .trim()
    .notEmpty().withMessage('The reset token is missing.'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters.')
    .matches(/[a-zA-Z]/).withMessage('New password must contain at least one letter.')
    .matches(/\d/).withMessage('New password must contain at least one number.')
    .custom(rejectCommonPassword),
];

module.exports = {
  registerRules,
  loginRules,
  updateProfileRules,
  changePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
  rejectCommonPassword,
};
