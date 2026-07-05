const path = require('path');
const express = require('express');

const { requirePageAuth } = require('../middleware/auth');
const { ROLES, DASHBOARD_PATHS } = require('../constants/roles');

const router = express.Router();
const VIEWS_DIR = path.join(__dirname, '..', '..', 'views');

const sendView = (relativePath) => (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, relativePath));
};

/**
 * Protected pages are served through Express (not from /public) so the
 * server verifies the session AND role before any dashboard HTML is sent.
 */
router.get('/client', requirePageAuth(ROLES.CLIENT), sendView('client/dashboard.html'));
router.get('/mixer', requirePageAuth(ROLES.PAINT_MIXER), sendView('mixer/dashboard.html'));
router.get('/cashier', requirePageAuth(ROLES.CASHIER), sendView('cashier/dashboard.html'));
router.get('/admin', requirePageAuth(ROLES.ADMIN), sendView('admin/dashboard.html'));

/** Convenience: /dashboard forwards any logged-in user to their own dashboard. */
router.get('/dashboard', requirePageAuth(), (req, res) => {
  res.redirect(DASHBOARD_PATHS[req.user.role]);
});

module.exports = router;
