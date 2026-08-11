const express = require('express');
const rateLimit = require('express-rate-limit');

const authController = require('../controllers/auth.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROLES } = require('../constants/roles');
const validate = require('../middleware/validate');
const {
  registerRules,
  loginRules,
  updateProfileRules,
  changePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
} = require('../validators/auth.validators');

const router = express.Router();

// Brute-force protection: counts only failed attempts per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 15 minutes.',
  },
});

// A hijacked session must not be able to brute-force the account's current
// password through the change-password form. Failed attempts only.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 15 minutes.',
  },
});

// Reset links are cheap to request — cap them hard (every request counts,
// successful or not, since each one may send an email).
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many reset requests. Please try again in 15 minutes.',
  },
});

router.post('/register', authLimiter, registerRules, validate, authController.register);
router.post('/login', authLimiter, loginRules, validate, authController.login);
router.post('/forgot-password', resetRequestLimiter, forgotPasswordRules, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordRules, validate, authController.resetPassword);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.me);
router.patch('/profile', requireAuth, updateProfileRules, validate, authController.updateProfile);
router.post('/change-password', requireAuth, changePasswordLimiter, changePasswordRules, validate, authController.changePassword);
// The walkthrough belongs to the customer module, so the flag that retires
// it is a customer's to set — staff have no tour to have been through.
router.post('/client-tour/complete', requireAuth, requireRole(ROLES.CLIENT), authController.completeClientTour);

module.exports = router;
