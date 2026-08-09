require('dotenv').config();

const connectDB = require('./src/config/db');
const createApp = require('./src/app');
const orderService = require('./src/services/order.service');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    if (!process.env.SESSION_SECRET) {
      throw new Error('SESSION_SECRET is not set. Copy .env.example to .env and configure it.');
    }

    await connectDB(process.env.MONGODB_URI);

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`Flavor & Color server running at http://localhost:${PORT}`);
    });

    /**
     * Housekeeping: runs at boot and then hourly.
     *
     * Abandoned checkouts are cancelled and their reserved stock returned
     * (order.service expireStaleOrders), and proof files no order refers to
     * are deleted (sweepOrphanedProofs). Both are independent — one failing
     * must not stop the other, and either will simply retry next hour.
     */
    const sweep = async () => {
      try {
        const count = await orderService.expireStaleOrders();
        if (count > 0) console.log(`Auto-cancelled ${count} stale unpaid order(s).`);
      } catch (err) {
        console.error('Stale-order sweep failed:', err.message);
      }

      try {
        const removed = await orderService.sweepOrphanedProofs();
        if (removed > 0) console.log(`Removed ${removed} orphaned payment proof(s).`);
      } catch (err) {
        console.error('Orphaned-proof sweep failed:', err.message);
      }
    };
    sweep();
    setInterval(sweep, 60 * 60 * 1000).unref();
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
