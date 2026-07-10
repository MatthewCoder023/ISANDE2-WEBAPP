/**
 * Resets the database to a pristine demo state:
 * wipes ALL data (users, products, orders, transactions, mixes,
 * formulas, settings, sessions, uploaded proofs) and re-runs the seeder.
 *
 * Handy right before a presentation. Never runs in production.
 *
 * Usage: npm run reset-demo
 */
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to reset demo data with NODE_ENV=production.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const COLLECTIONS = [
  'orders',
  'transactions',
  'stockmovements',
  'mixrequests',
  'colorformulas',
  'products',
  'users',
  'settings',
  'sessions',
];

async function reset() {
  await connectDB(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  for (const name of COLLECTIONS) {
    const { deletedCount } = await db.collection(name).deleteMany({});
    console.log(`cleared ${name} (${deletedCount})`);
  }

  const proofsDir = path.join(__dirname, '..', 'uploads', 'proofs');
  if (fs.existsSync(proofsDir)) {
    for (const file of fs.readdirSync(proofsDir)) {
      fs.unlinkSync(path.join(proofsDir, file));
    }
  }
  console.log('cleared uploaded payment proofs');

  await mongoose.disconnect();

  console.log('\nReseeding…\n');
  execSync('node scripts/seed.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
