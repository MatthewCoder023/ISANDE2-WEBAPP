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

    // Abandoned-checkout sweep: runs at boot and then hourly. Cancels
    // pending_payment orders idle past the cutoff and returns their
    // reserved stock (see order.service expireStaleOrders).
    const sweepStaleOrders = async () => {
      try {
        const count = await orderService.expireStaleOrders();
        if (count > 0) console.log(`Auto-cancelled ${count} stale unpaid order(s).`);
      } catch (err) {
        console.error('Stale-order sweep failed:', err.message);
      }
    };
    sweepStaleOrders();
    setInterval(sweepStaleOrders, 60 * 60 * 1000).unref();
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
