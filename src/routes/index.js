const express = require('express');
const authRoutes = require('./auth.routes');
const productsRoutes = require('./products.routes');
const ordersRoutes = require('./orders.routes');
const transactionsRoutes = require('./transactions.routes');
const mixingRoutes = require('./mixing.routes');
const formulasRoutes = require('./formulas.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/mixing', mixingRoutes);
router.use('/formulas', formulasRoutes);

// Future modules mount here:
// router.use('/users', userRoutes);        (admin only)

module.exports = router;
