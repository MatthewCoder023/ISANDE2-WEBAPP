const express = require('express');

const formulasController = require('../controllers/formulas.controller');
const { requireAuth, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { ROLES } = require('../constants/roles');
const { createFormulaRules, updateFormulaRules } = require('../validators/mixing.validators');

const router = express.Router();

// The formula library is production knowledge: mixer and admin only.
router.use(requireAuth, requireRole(ROLES.PAINT_MIXER, ROLES.ADMIN));

router.get('/', formulasController.list);
router.post('/', createFormulaRules, validate, formulasController.create);
router.patch('/:id', updateFormulaRules, validate, formulasController.update);
router.delete('/:id', formulasController.archive);

module.exports = router;
