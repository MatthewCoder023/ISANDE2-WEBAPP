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
router.get('/client/products', requirePageAuth(ROLES.CLIENT), sendView('client/products.html'));
router.get('/client/orders', requirePageAuth(ROLES.CLIENT), sendView('client/orders.html'));
router.get('/client/colors', requirePageAuth(ROLES.CLIENT), sendView('client/colors.html'));
router.get('/mixer', requirePageAuth(ROLES.PAINT_MIXER), sendView('mixer/dashboard.html'));

// Production pages are shared by paint mixer and admin; tabs within the
// pages switch between queue, formulas, and the production log.
router.get('/mixing', requirePageAuth(ROLES.PAINT_MIXER, ROLES.ADMIN), sendView('mixing/queue.html'));
router.get('/mixing/formulas', requirePageAuth(ROLES.PAINT_MIXER, ROLES.ADMIN), sendView('mixing/formulas.html'));
router.get('/mixing/log', requirePageAuth(ROLES.PAINT_MIXER, ROLES.ADMIN), sendView('mixing/log.html'));
router.get('/cashier', requirePageAuth(ROLES.CASHIER), sendView('cashier/dashboard.html'));
router.get('/admin', requirePageAuth(ROLES.ADMIN), sendView('admin/dashboard.html'));
router.get('/admin/products', requirePageAuth(ROLES.ADMIN), sendView('admin/products.html'));

// Sales pages are shared by cashier and admin; the sidebar adapts per role.
router.get('/pos', requirePageAuth(ROLES.CASHIER, ROLES.ADMIN), sendView('staff/pos.html'));
router.get('/orders', requirePageAuth(ROLES.CASHIER, ROLES.ADMIN), sendView('staff/orders.html'));
router.get('/transactions', requirePageAuth(ROLES.CASHIER, ROLES.ADMIN), sendView('staff/transactions.html'));

/** Convenience: /dashboard forwards any logged-in user to their own dashboard. */
router.get('/dashboard', requirePageAuth(), (req, res) => {
  res.redirect(DASHBOARD_PATHS[req.user.role]);
});

module.exports = router;
