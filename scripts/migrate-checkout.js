/**
 * One-off migration for the Phase 5 checkout rework:
 *  - maps the retired 'pending' status to 'preparing' (old semantics:
 *    awaiting fulfilment, pay at pickup)
 *  - backfills statusHistory for orders created before the tracker
 *
 * Safe to re-run: it only touches documents that need it.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

async function migrate() {
  await connectDB(process.env.MONGODB_URI);
  const orders = mongoose.connection.collection('orders');

  const renamed = await orders.updateMany(
    { status: 'pending' },
    { $set: { status: 'preparing' } }
  );
  console.log(`status pending -> preparing: ${renamed.modifiedCount} order(s)`);

  const legacy = await orders
    .find({ $or: [{ statusHistory: { $exists: false } }, { statusHistory: { $size: 0 } }] })
    .toArray();

  for (const order of legacy) {
    const history = [
      { status: 'pending_payment', at: order.createdAt, by: order.placedBy, note: 'Order placed' },
    ];
    if (order.readyAt) history.push({ status: 'ready', at: order.readyAt, by: null, note: '' });
    if (order.completedAt) {
      history.push({ status: 'completed', at: order.completedAt, by: null, note: '' });
    }
    if (order.cancelledAt) {
      history.push({ status: 'cancelled', at: order.cancelledAt, by: null, note: '' });
    }
    // eslint-disable-next-line no-await-in-loop
    await orders.updateOne({ _id: order._id }, { $set: { statusHistory: history } });
  }
  console.log(`statusHistory backfilled: ${legacy.length} order(s)`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
