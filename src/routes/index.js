const express = require('express');
const authRoutes = require('./auth.routes');

const router = express.Router();

router.use('/auth', authRoutes);

// Future modules mount here:
// router.use('/products', productRoutes);
// router.use('/orders', orderRoutes);
// router.use('/users', userRoutes);        (admin only)
// router.use('/mixing', mixingRoutes);     (paint mixer)
// router.use('/transactions', txRoutes);   (cashier)

module.exports = router;
