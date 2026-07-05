const express = require('express');
const authRoutes = require('./auth.routes');
const productsRoutes = require('./products.routes');
const ordersRoutes = require('./orders.routes');
const transactionsRoutes = require('./transactions.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/transactions', transactionsRoutes);

// Future modules mount here:
// router.use('/users', userRoutes);        (admin only)
// router.use('/mixing', mixingRoutes);     (paint mixer)

module.exports = router;
