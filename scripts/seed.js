/**
 * Seeds one account per role for development and demos.
 * Idempotent: existing emails are skipped, so it is safe to re-run.
 *
 * Usage: npm run seed
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const { ROLES } = require('../src/constants/roles');

const SEED_USERS = [
  {
    firstName: 'System',
    lastName: 'Administrator',
    email: 'admin@flavorandcolor.com',
    password: 'Admin@1234',
    role: ROLES.ADMIN,
  },
  {
    firstName: 'Paolo',
    lastName: 'Mixer',
    email: 'mixer@flavorandcolor.com',
    password: 'Mixer@1234',
    role: ROLES.PAINT_MIXER,
  },
  {
    firstName: 'Cathy',
    lastName: 'Cashier',
    email: 'cashier@flavorandcolor.com',
    password: 'Cashier@1234',
    role: ROLES.CASHIER,
  },
  {
    firstName: 'Carlos',
    lastName: 'Customer',
    email: 'client@example.com',
    password: 'Client@1234',
    role: ROLES.CLIENT,
  },
];

async function seed() {
  await connectDB(process.env.MONGODB_URI);

  for (const data of SEED_USERS) {
    const exists = await User.findOne({ email: data.email });
    if (exists) {
      console.log(`skip   ${data.email} (already exists)`);
      continue;
    }
    await User.create(data); // password hashed by the model's pre-save hook
    console.log(`create ${data.email} [${data.role}] password: ${data.password}`);
  }

  console.log('\nSeeding complete. Change these passwords before any real deployment.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
