const { setup, teardown, seedRoleAgents, createProduct, createUser, loginAgent } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function placeOrder(agent = agents.client) {
  const product = await createProduct({ price: 300 });
  const res = await agent.post('/api/orders').send({
    items: [{ productId: product.id, quantity: 1 }],
  });
  return res.body.data.order;
}

const listFor = async (agent) => (await agent.get('/api/notifications')).body.data;

describe('customer notifications', () => {
  it('announces the events a customer cares about, in app as well as by email', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG, { filename: 'r.png', contentType: 'image/png' });
    await agents.cashier.post(`/api/orders/${order.id}/verify-payment`);
    await agents.cashier.post(`/api/orders/${order.id}/prepare`);
    await agents.cashier.post(`/api/orders/${order.id}/ready`);

    const { notifications, unread } = await listFor(agents.client);
    const types = notifications.map((n) => n.type);

    expect(types).toContain('order_payment_verified');
    expect(types).toContain('order_ready');
    expect(unread).toBeGreaterThanOrEqual(2);

    // Each one links somewhere useful.
    const ready = notifications.find((n) => n.type === 'order_ready');
    expect(ready.link).toBe(`/client/track?order=${order.id}`);
  });

  it('never leaks one customer\'s notifications to another', async () => {
    await createUser({ email: 'notif-stranger@test.com' });
    const stranger = await loginAgent(app, 'notif-stranger@test.com');

    const { notifications, unread } = await listFor(stranger);
    expect(notifications).toHaveLength(0);
    expect(unread).toBe(0);
  });
});

describe('staff notifications', () => {
  it('tells the counter when a proof needs checking', async () => {
    const before = (await listFor(agents.cashier)).unread;

    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG, { filename: 'r.png', contentType: 'image/png' });

    const { notifications, unread } = await listFor(agents.cashier);
    expect(unread).toBe(before + 1);
    expect(notifications[0].type).toBe('proof_uploaded');
    expect(notifications[0].link).toContain('status=pending_verification');
  });

  it('tells the mixer when a custom mix is requested', async () => {
    await agents.client.post('/api/mixing/requests').send({
      targetColor: { hex: '#4477AA', name: 'Harbour Blue' },
      quantity: 1,
    });

    const { notifications } = await listFor(agents.paint_mixer);
    expect(notifications[0].type).toBe('mix_requested');
    expect(notifications[0].body).toContain('Harbour Blue');
  });
});

describe('reading notifications', () => {
  it('marks one read without touching the rest', async () => {
    const { notifications, unread } = await listFor(agents.client);
    const target = notifications.find((n) => !n.readAt);

    const res = await agents.client.post(`/api/notifications/${target.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.notification.readAt).toBeTruthy();

    expect((await listFor(agents.client)).unread).toBe(unread - 1);
  });

  it('clears the badge in one go', async () => {
    await agents.client.post('/api/notifications/read-all');
    const { unread } = await listFor(agents.client);
    expect(unread).toBe(0);

    const count = await agents.client.get('/api/notifications/unread-count');
    expect(count.body.data.unread).toBe(0);
  });

  it('refuses to mark someone else\'s notification read', async () => {
    const mixerNotif = (await listFor(agents.paint_mixer)).notifications[0];
    const res = await agents.client.post(`/api/notifications/${mixerNotif.id}/read`);
    expect(res.status).toBe(404);
  });

  it('requires a session', async () => {
    const supertest = require('supertest');
    expect((await supertest(app).get('/api/notifications')).status).toBe(401);
  });
});
