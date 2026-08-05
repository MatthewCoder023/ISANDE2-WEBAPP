const supertest = require('supertest');
const { setup, teardown, seedRoleAgents, loginAgent, PASSWORD } = require('./helpers');

let app;
let agents;
let users;

beforeAll(async () => {
  app = await setup();
  ({ agents, users } = await seedRoleAgents(app));
});
afterAll(teardown);

describe('employee management', () => {
  it('creates an employee who can log in with the given password', async () => {
    const res = await agents.admin.post('/api/users').send({
      firstName: 'Nina',
      lastName: 'Reyes',
      email: 'nina@test.com',
      password: 'N1naP@ss2026!',
      role: 'cashier',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('cashier');

    const agent = await loginAgent(app, 'nina@test.com', 'N1naP@ss2026!');
    expect((await agent.get('/api/orders')).status).toBe(200);
  });

  it('locks a deactivated employee out on their very next request', async () => {
    const nina = await loginAgent(app, 'nina@test.com', 'N1naP@ss2026!');
    expect((await nina.get('/api/orders')).status).toBe(200);

    const ninaId = (await agents.admin.get('/api/users?search=nina')).body.data.users[0].id;
    await agents.admin.patch(`/api/users/${ninaId}`).send({ isActive: false });

    expect((await nina.get('/api/orders')).status).toBe(401);

    await agents.admin.patch(`/api/users/${ninaId}`).send({ isActive: true });
  });

  it('resets a password: the old one stops working immediately', async () => {
    const ninaId = (await agents.admin.get('/api/users?search=nina')).body.data.users[0].id;
    await agents.admin.post(`/api/users/${ninaId}/reset-password`).send({ password: 'Fr3shP@ss2026!' });

    const oldLogin = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'nina@test.com', password: 'N1naP@ss2026!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'nina@test.com', password: 'Fr3shP@ss2026!' });
    expect(newLogin.status).toBe(200);
  });

  it('ignores email changes (login identity is immutable)', async () => {
    const ninaId = (await agents.admin.get('/api/users?search=nina')).body.data.users[0].id;
    const res = await agents.admin
      .patch(`/api/users/${ninaId}`)
      .send({ email: 'stolen@test.com', firstName: 'Nina' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('nina@test.com');
  });
});

describe('lockout guards', () => {
  it('blocks admins from changing their own role or deactivating themselves', async () => {
    const selfId = users.admin.id;

    const demote = await agents.admin.patch(`/api/users/${selfId}`).send({ role: 'cashier' });
    expect(demote.status).toBe(400);

    const deactivate = await agents.admin.patch(`/api/users/${selfId}`).send({ isActive: false });
    expect(deactivate.status).toBe(400);
  });

  it('allows managing another admin while at least one remains active', async () => {
    await agents.admin.post('/api/users').send({
      firstName: 'Second',
      lastName: 'Admin',
      email: 'admin2@test.com',
      password: PASSWORD,
      role: 'admin',
    });
    const admin2Id = (await agents.admin.get('/api/users?search=admin2')).body.data.users[0].id;

    const deactivate = await agents.admin.patch(`/api/users/${admin2Id}`).send({ isActive: false });
    expect(deactivate.status).toBe(200);

    const restore = await agents.admin.patch(`/api/users/${admin2Id}`).send({ isActive: true });
    expect(restore.status).toBe(200);
  });
});

describe('customer records', () => {
  it('lists customers with their order stats for the cashier', async () => {
    const { createProduct } = require('./helpers');
    const product = await createProduct({ price: 200 });
    await agents.client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 2 }],
    });

    const res = await agents.cashier.get('/api/customers?search=client');
    expect(res.status).toBe(200);

    const customer = res.body.data.customers.find((c) => c.email === 'client@test.com');
    expect(customer).toBeDefined();
    expect(customer.orders).toBeGreaterThanOrEqual(1);
    expect(customer.lastOrderAt).toBeTruthy();
    // Spend counts completed orders only — this one is still pending payment.
    expect(customer.spent).toBe(0);
  });

  it('exposes a specific customer order history to staff', async () => {
    const customerId = (await agents.cashier.get('/api/customers?search=client')).body.data
      .customers[0].id;

    const res = await agents.cashier.get(`/api/orders?customer=${customerId}&limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.data.orders.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.orders.every((o) => o.customer === customerId)).toBe(true);
  });
});

describe('security log', () => {
  it('records auth events and shows them to admins only', async () => {
    const res = await agents.admin.get('/api/users/events');
    expect(res.status).toBe(200);
    expect(res.body.data.events.length).toBeGreaterThan(0);
    expect(res.body.data.events.some((e) => e.type === 'login_success')).toBe(true);

    expect((await agents.cashier.get('/api/users/events')).status).toBe(403);
    expect((await agents.client.get('/api/users/events')).status).toBe(403);
  });

  it('strips NoSQL operator injections from query input', async () => {
    const res = await agents.admin.get('/api/users?search[$gt]=x');
    expect(res.status).toBe(200);
    expect(res.body.data.users.length).toBeGreaterThan(0);
  });
});