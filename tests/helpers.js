/**
 * Shared test harness: boots the Express app against an in-memory
 * MongoDB and provides user/product factories plus logged-in agents.
 * Each test file gets its own isolated database and app instance.
 */
process.env.SESSION_SECRET = 'test-secret';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const supertest = require('supertest');

const createApp = require('../src/app');
const User = require('../src/models/User');
const Product = require('../src/models/Product');

const PASSWORD = 'Passw0rd1';
let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  return createApp();
}

async function teardown() {
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
}

let userCounter = 0;
function createUser(overrides = {}) {
  userCounter += 1;
  return User.create({
    firstName: 'Test',
    lastName: `User${userCounter}`,
    email: `user${userCounter}@test.com`,
    password: PASSWORD,
    role: 'client',
    ...overrides,
  });
}

let skuCounter = 0;
function createProduct(overrides = {}) {
  skuCounter += 1;
  return Product.create({
    name: `Test Paint ${skuCounter}`,
    sku: `TEST-${String(skuCounter).padStart(4, '0')}`,
    category: 'interior',
    finish: 'flat',
    size: '4L',
    color: { name: 'Test Blue', hex: '#3355AA' },
    price: 100,
    stock: { quantity: 20, lowStockThreshold: 5 },
    ...overrides,
  });
}

async function loginAgent(app, email, password = PASSWORD) {
  const agent = supertest.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Test login failed for ${email}: ${res.status} ${res.body.message}`);
  }
  return agent;
}

/** One account + logged-in agent per role, for RBAC-style suites. */
async function seedRoleAgents(app) {
  const users = {};
  const agents = {};
  for (const role of ['admin', 'cashier', 'paint_mixer', 'client']) {
    users[role] = await createUser({ role, email: `${role}@test.com` });
    agents[role] = await loginAgent(app, `${role}@test.com`);
  }
  return { users, agents };
}

module.exports = {
  setup,
  teardown,
  createUser,
  createProduct,
  loginAgent,
  seedRoleAgents,
  PASSWORD,
};
