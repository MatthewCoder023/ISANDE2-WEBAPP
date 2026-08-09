/**
 * Seeds one account per role and a demo product catalog.
 * Idempotent: existing emails/SKUs are skipped, so it is safe to re-run.
 *
 * Usage: npm run seed
 */
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const ColorFormula = require('../src/models/ColorFormula');
const MixRequest = require('../src/models/MixRequest');
const Supplier = require('../src/models/Supplier');
const { ROLES } = require('../src/constants/roles');
const { PRODUCT_CATEGORIES: CAT } = require('../src/constants/products');

const SEED_USERS = [
  {
    // A person, not a job title: the dashboards greet users by first name,
    // and "Welcome, System!" is nobody.
    firstName: 'Alma',
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

// Quantities are deliberately varied: a few low-stock and one out-of-stock
// item so dashboards and filters have realistic data to show.
const SEED_PRODUCTS = [
  { sku: 'FC-INT-1001', name: 'Sunrise Coral', category: CAT.INTERIOR, finish: 'satin', size: '4L', color: { name: 'Sunrise Coral', hex: '#FF6F61' }, price: 895, stock: { quantity: 24, lowStockThreshold: 5 }, description: 'Warm coral tone for living spaces. Smooth satin sheen, easy to wipe clean.' },
  { sku: 'FC-INT-1002', name: 'Morning Mist', category: CAT.INTERIOR, finish: 'flat', size: '1L', color: { name: 'Morning Mist', hex: '#E8EAE6' }, price: 265, stock: { quantity: 40, lowStockThreshold: 8 }, description: 'Soft off-white with a whisper of gray. Great for ceilings and calm bedrooms.' },
  { sku: 'FC-INT-1003', name: 'Deep Ocean', category: CAT.INTERIOR, finish: 'semi-gloss', size: '4L', color: { name: 'Deep Ocean', hex: '#1B4F72' }, price: 940, stock: { quantity: 4, lowStockThreshold: 5 }, description: 'Bold navy accent color with a durable semi-gloss finish.' },
  { sku: 'FC-INT-1004', name: 'Golden Hour', category: CAT.INTERIOR, finish: 'eggshell', size: '4L', color: { name: 'Golden Hour', hex: '#F2C14E' }, price: 895, stock: { quantity: 16, lowStockThreshold: 5 }, description: 'Cozy amber yellow that glows in the afternoon light.' },
  { sku: 'FC-EXT-2001', name: 'Terra Cotta Sunset', category: CAT.EXTERIOR, finish: 'matte', size: '4L', color: { name: 'Terra Cotta', hex: '#C1440E' }, price: 1150, stock: { quantity: 18, lowStockThreshold: 5 }, description: 'Weather-resistant earthy red for facades and garden walls.' },
  { sku: 'FC-EXT-2002', name: 'Bamboo Grove', category: CAT.EXTERIOR, finish: 'satin', size: '16L', color: { name: 'Bamboo Grove', hex: '#6B8E23' }, price: 3480, stock: { quantity: 7, lowStockThreshold: 4 }, description: 'Fresh olive green, UV-stable and rain-proof for tropical climates.' },
  { sku: 'FC-EXT-2003', name: 'Pearl White Weathershield', category: CAT.EXTERIOR, finish: 'gloss', size: '16L', color: { name: 'Pearl White', hex: '#F5F5F0' }, price: 3650, stock: { quantity: 0, lowStockThreshold: 4 }, description: 'Classic brilliant white with anti-mildew protection.' },
  { sku: 'FC-PRM-3001', name: 'All-Surface Primer', category: CAT.PRIMER, finish: 'flat', size: '4L', color: { name: 'Neutral White', hex: '#EDEDED' }, price: 720, stock: { quantity: 30, lowStockThreshold: 8 }, description: 'High-adhesion primer for concrete, wood, and previously painted surfaces.' },
  { sku: 'FC-ENM-4001', name: 'Metal Guard Gray', category: CAT.ENAMEL, finish: 'gloss', size: '1L', color: { name: 'Machine Gray', hex: '#808487' }, price: 385, stock: { quantity: 12, lowStockThreshold: 5 }, description: 'Rust-inhibiting enamel for gates, grills, and steel furniture.' },
  { sku: 'FC-ENM-4002', name: 'Mahogany Wood Stain', category: CAT.ENAMEL, finish: 'satin', size: '1L', color: { name: 'Mahogany', hex: '#4E2A14' }, price: 410, stock: { quantity: 3, lowStockThreshold: 5 }, description: 'Rich wood stain that deepens grain while sealing against moisture.' },
  { sku: 'FC-SPR-5001', name: 'Fire Red Spray', category: CAT.SPRAY, finish: 'gloss', size: '500mL', color: { name: 'Fire Red', hex: '#D32F2F' }, price: 185, stock: { quantity: 25, lowStockThreshold: 10 }, description: 'Fast-drying aerosol for touch-ups, crafts, and small projects.' },
  { sku: 'FC-SUP-6001', name: 'Paint Roller Set 9"', category: CAT.SUPPLIES, price: 249, stock: { quantity: 15, lowStockThreshold: 5 }, description: 'Roller frame with two microfiber sleeves and a paint tray.' },
  { sku: 'FC-SUP-6002', name: "Painter's Tape 24mm", category: CAT.SUPPLIES, price: 89, stock: { quantity: 2, lowStockThreshold: 10 }, description: 'Clean-release masking tape for crisp edges. 20-meter roll.' },
];

async function seed() {
  await connectDB(process.env.MONGODB_URI);

  for (const data of SEED_USERS) {
    const exists = await User.findOne({ email: data.email });
    if (exists) {
      /**
       * The admin account used to be named "System Administrator", which
       * left the dashboard greeting people with "Welcome, System!".
       * Databases seeded before that fix are corrected in place — only the
       * legacy name, so an account someone has deliberately renamed since
       * is left alone.
       */
      if (exists.firstName === 'System' && data.firstName !== 'System') {
        exists.firstName = data.firstName;
        await exists.save();
        console.log(`rename ${data.email} -> ${data.firstName} ${exists.lastName}`);
        continue;
      }
      console.log(`skip   ${data.email} (already exists)`);
      continue;
    }
    await User.create(data); // password hashed by the model's pre-save hook
    console.log(`create ${data.email} [${data.role}] password: ${data.password}`);
  }

  for (const data of SEED_PRODUCTS) {
    const exists = await Product.findOne({ sku: data.sku });
    if (exists) {
      console.log(`skip   ${data.sku} (already exists)`);
      continue;
    }
    await Product.create(data);
    console.log(`create ${data.sku} ${data.name} (qty ${data.stock.quantity})`);
  }

  await seedSuppliers();
  await seedMixing();

  console.log('\nSeeding complete. Change these passwords before any real deployment.');
  await mongoose.disconnect();
}

/**
 * A few suppliers so the purchase order module has somewhere to send an
 * order on a fresh install. No purchase orders are seeded: a PO that was
 * never actually raised would put stock on the shelf from nowhere, which is
 * the exact thing the module exists to prevent.
 */
async function seedSuppliers() {
  const suppliers = [
    {
      name: 'Vernici Supply Co.',
      contactPerson: 'Rene Cruz',
      email: 'sales@vernicisupply.example',
      phone: '0917 555 0110',
      address: '18 Industrial Ave, Valenzuela City',
      paymentTerms: '30 days',
    },
    {
      name: 'Pigment House Manila',
      contactPerson: 'Divina Santos',
      email: 'orders@pigmenthouse.example',
      phone: '0917 555 0220',
      address: '7 Bagumbayan St, Quezon City',
      paymentTerms: 'COD',
    },
    {
      name: 'Hardware Depot Inc.',
      contactPerson: 'Ariel Manalo',
      email: 'purchasing@hardwaredepot.example',
      phone: '0917 555 0330',
      address: '221 Commonwealth Ave, Quezon City',
      paymentTerms: '15 days',
    },
  ];

  for (const data of suppliers) {
    const exists = await Supplier.findOne({ name: data.name });
    if (exists) {
      console.log(`skip   supplier ${data.name} (already exists)`);
      continue;
    }
    await Supplier.create(data);
    console.log(`create supplier ${data.name}`);
  }
}

/** Sample formulas + a couple of queued requests so the bench has work. */
async function seedMixing() {
  const mixer = await User.findOne({ email: 'mixer@flavorandcolor.com' });
  const client = await User.findOne({ email: 'client@example.com' });
  if (!mixer || !client) return;

  const SEED_FORMULAS = [
    {
      name: 'Sunrise Coral (4L base)',
      colorHex: '#FF6F61',
      components: [
        { name: 'White base', amount: 3.6, unit: 'mL' },
        { name: 'Red oxide', amount: 220, unit: 'mL' },
        { name: 'Yellow oxide', amount: 90, unit: 'mL' },
      ],
      notes: 'Stir base 2 minutes before tinting. Matches FC-INT-1001.',
    },
    {
      name: 'Deep Ocean (4L base)',
      colorHex: '#1B4F72',
      components: [
        { name: 'White base', amount: 3.4, unit: 'mL' },
        { name: 'Phthalo blue', amount: 340, unit: 'mL' },
        { name: 'Lamp black', amount: 60, unit: 'drops' },
      ],
      notes: 'Deep navy — check under daylight before sealing the can.',
    },
    {
      name: 'Bamboo Grove (16L base)',
      colorHex: '#6B8E23',
      components: [
        { name: 'White base', amount: 14, unit: 'mL' },
        { name: 'Chrome green', amount: 900, unit: 'mL' },
        { name: 'Yellow oxide', amount: 400, unit: 'mL' },
      ],
    },
  ];

  for (const data of SEED_FORMULAS) {
    const exists = await ColorFormula.findOne({ name: data.name });
    if (exists) {
      console.log(`skip   formula "${data.name}" (already exists)`);
      continue;
    }
    await ColorFormula.create({ ...data, createdBy: mixer._id });
    console.log(`create formula "${data.name}"`);
  }

  const SEED_REQUESTS = [
    {
      requestNumber: 'MIX-SEED-1001',
      targetColor: { hex: '#7A9E7E', name: 'Sage Whisper' },
      quantity: 2,
      notes: 'For a bedroom accent wall — slightly muted is fine.',
    },
    {
      requestNumber: 'MIX-SEED-1002',
      targetColor: { hex: '#C46A2B', name: 'Toasted Caramel' },
      quantity: 1,
      notes: 'Matching a sample swatch from a furniture catalog.',
    },
  ];

  for (const data of SEED_REQUESTS) {
    const exists = await MixRequest.findOne({ requestNumber: data.requestNumber });
    if (exists) {
      console.log(`skip   ${data.requestNumber} (already exists)`);
      continue;
    }
    await MixRequest.create({
      ...data,
      customer: client._id,
      customerName: client.fullName,
      placedBy: client._id,
    });
    console.log(`create ${data.requestNumber} "${data.targetColor.name}"`);
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
