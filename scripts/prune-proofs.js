/**
 * Reconciles uploaded payment proofs against the orders that reference them.
 *
 * The running app does this hourly (see server.js), but a one-off report is
 * useful after restoring a backup, moving UPLOAD_DIR, or simply to see how
 * much has accumulated. It also names the opposite problem the sweep cannot
 * fix: orders pointing at a file that is no longer on disk.
 *
 *   node scripts/prune-proofs.js --dry-run   # report only, delete nothing
 *   node scripts/prune-proofs.js             # report, then delete orphans
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../src/config/db');
const Order = require('../src/models/Order');
const { PROOFS_DIR } = require('../src/config/uploads');
const { sweepOrphanedProofs, ORPHAN_GRACE_HOURS } = require('../src/services/order.service');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectDB(process.env.MONGODB_URI);
  console.log(`proofs directory: ${PROOFS_DIR}\n`);

  const files = fs.existsSync(PROOFS_DIR) ? fs.readdirSync(PROOFS_DIR) : [];
  const orders = await Order.find({ 'payment.proof.filename': { $ne: '' } }).select(
    'orderNumber payment.proof.filename'
  );

  const referenced = new Map();
  for (const order of orders) {
    const name = order.payment?.proof?.filename;
    if (name) referenced.set(name, order.orderNumber);
  }

  const onDisk = new Set(files);
  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000;

  const orphans = files.filter((name) => !referenced.has(name));
  const sweepable = orphans.filter((name) => {
    try {
      return fs.statSync(path.join(PROOFS_DIR, name)).mtimeMs < cutoff;
    } catch {
      return false;
    }
  });

  // The failure the sweep cannot repair: the order still claims a proof,
  // but the image behind it is gone. Worth naming loudly — each one is an
  // order whose payment evidence cannot be produced.
  const missing = [...referenced.entries()].filter(([name]) => !onDisk.has(name));

  console.log(`files on disk        : ${files.length}`);
  console.log(`referenced by orders : ${referenced.size}`);
  console.log(`orphaned             : ${orphans.length}`);
  console.log(`  ├─ old enough to remove : ${sweepable.length}`);
  console.log(`  └─ inside the ${ORPHAN_GRACE_HOURS}h grace window : ${orphans.length - sweepable.length}`);

  if (missing.length > 0) {
    console.log(`\nMISSING — ${missing.length} order(s) reference a file that is not on disk:`);
    for (const [name, orderNumber] of missing) console.log(`  ${orderNumber}  ${name}`);
    console.log('\nThese cannot be recovered here. The customer must re-upload their proof.');
  }

  if (dryRun) {
    console.log('\nDry run — nothing deleted.');
  } else if (sweepable.length === 0) {
    console.log('\nNothing to delete.');
  } else {
    const deleted = await sweepOrphanedProofs();
    console.log(`\nDeleted ${deleted} orphaned proof file(s).`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('prune-proofs failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
