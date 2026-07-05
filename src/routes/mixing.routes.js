const express = require('express');

const mixingController = require('../controllers/mixing.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const { createMixRequestRules, completeMixRules } = require('../validators/mixing.validators');

const router = express.Router();

const MIXER_ROLES = [ROLES.PAINT_MIXER, ROLES.ADMIN];

router.use(requireAuth);

// Reads are role-shaped in the controller (clients only ever see their own).
router.get('/requests', mixingController.list);
router.get('/stats', mixingController.stats);
router.get('/requests/:id', mixingController.getById);

// Any signed-in user can request a mix (customers, cashiers on behalf of
// walk-ins, the mixer directly).
router.post('/requests', createMixRequestRules, validate, mixingController.create);

// Bench work is mixer/admin only.
router.post('/requests/:id/start', requireRole(...MIXER_ROLES), mixingController.start);
router.post('/requests/:id/complete', requireRole(...MIXER_ROLES), completeMixRules, validate, mixingController.complete);
router.post('/requests/:id/cancel', mixingController.cancel);

module.exports = router;
