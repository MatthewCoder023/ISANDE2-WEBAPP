const express = require('express');
const authRoutes = require('./auth.routes');
const productsRoutes = require('./products.routes');
const ordersRoutes = require('./orders.routes');
const transactionsRoutes = require('./transactions.routes');
const mixingRoutes = require('./mixing.routes');
const formulasRoutes = require('./formulas.routes');
const usersRoutes = require('./users.routes');
const settingsRoutes = require('./settings.routes');
const reportsRoutes = require('./reports.routes');
const notificationsRoutes = require('./notifications.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/mixing', mixingRoutes);
router.use('/formulas', formulasRoutes);
router.use('/users', usersRoutes);
router.use('/customers', require('./customers.routes'));
router.use('/settings', settingsRoutes);
router.use('/reports', reportsRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
