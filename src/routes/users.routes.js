const express = require('express');

const usersController = require('../controllers/users.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const {
  createUserRules,
  updateUserRules,
  resetPasswordRules,
} = require('../validators/users.validators');

const router = express.Router();

// User management is System Administrator territory, full stop.
router.use(requireAuth, requireRole(ROLES.ADMIN));

router.get('/', usersController.list);
router.get('/stats', usersController.stats);
router.post('/', createUserRules, validate, usersController.create);
router.patch('/:id', updateUserRules, validate, usersController.update);
router.post('/:id/reset-password', resetPasswordRules, validate, usersController.resetPassword);

module.exports = router;
