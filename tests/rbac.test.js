const supertest = require('supertest');
const { setup, teardown, seedRoleAgents } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

/**
 * RBAC matrix: [method, path, body, { role: expectedStatusPrefix }]
 * '2xx/4xx' checks only the class, since some calls fail validation
 * AFTER passing authorization (which is what this suite cares about).
 */
const FORBIDDEN = 403;

describe('role-based access control', () => {
  it('locks product management to admin', async () => {
    const body = { name: 'X', category: 'interior', price: 1 };
    expect((await agents.client.post('/api/products').send(body)).status).toBe(FORBIDDEN);
    expect((await agents.cashier.post('/api/products').send(body)).status).toBe(FORBIDDEN);
    expect((await agents.paint_mixer.post('/api/products').send(body)).status).toBe(FORBIDDEN);
    expect((await agents.admin.post('/api/products').send(body)).status).toBe(201);
  });

  it('locks user management to admin', async () => {
    for (const role of ['client', 'cashier', 'paint_mixer']) {
      expect((await agents[role].get('/api/users')).status).toBe(FORBIDDEN);
    }
    expect((await agents.admin.get('/api/users')).status).toBe(200);
  });

  it('locks reports to admin', async () => {
    for (const role of ['client', 'cashier', 'paint_mixer']) {
      expect((await agents[role].get('/api/reports/sales')).status).toBe(FORBIDDEN);
    }
    expect((await agents.admin.get('/api/reports/sales')).status).toBe(200);
  });

  it('locks settings writes to admin but lets everyone read', async () => {
    for (const role of ['client', 'cashier', 'paint_mixer', 'admin']) {
      expect((await agents[role].get('/api/settings')).status).toBe(200);
    }
    for (const role of ['client', 'cashier', 'paint_mixer']) {
      expect((await agents[role].patch('/api/settings').send({ shopName: 'Hacked' })).status).toBe(
        FORBIDDEN
      );
    }
  });

  it('gives transactions and customers to cashier and admin only', async () => {
    for (const path of ['/api/transactions', '/api/customers']) {
      expect((await agents.client.get(path)).status).toBe(FORBIDDEN);
      expect((await agents.paint_mixer.get(path)).status).toBe(FORBIDDEN);
      expect((await agents.cashier.get(path)).status).toBe(200);
      expect((await agents.admin.get(path)).status).toBe(200);
    }
  });

  it('keeps the formula library for mixer and admin', async () => {
    expect((await agents.client.get('/api/formulas')).status).toBe(FORBIDDEN);
    expect((await agents.cashier.get('/api/formulas')).status).toBe(FORBIDDEN);
    expect((await agents.paint_mixer.get('/api/formulas')).status).toBe(200);
    expect((await agents.admin.get('/api/formulas')).status).toBe(200);
  });

  it('keeps orders away from the paint mixer, and POS away from clients', async () => {
    expect((await agents.paint_mixer.get('/api/orders')).status).toBe(FORBIDDEN);
    expect(
      (await agents.client.post('/api/orders/walk-in').send({ items: [], payment: {} })).status
    ).toBe(FORBIDDEN);
  });

  it('locks CSV exports to their roles', async () => {
    expect((await agents.client.get('/api/transactions/export')).status).toBe(FORBIDDEN);
    expect((await agents.paint_mixer.get('/api/transactions/export')).status).toBe(FORBIDDEN);
    expect((await agents.cashier.get('/api/transactions/export')).status).toBe(200);

    expect((await agents.cashier.get('/api/products/export')).status).toBe(FORBIDDEN);
    const inventory = await agents.admin.get('/api/products/export');
    expect(inventory.status).toBe(200);
    expect(inventory.headers['content-type']).toContain('text/csv');
    expect(inventory.headers['content-disposition']).toContain('inventory-');
  });

  it('requires authentication everywhere', async () => {
    for (const path of ['/api/products', '/api/orders', '/api/settings', '/api/mixing/requests']) {
      expect((await supertest(app).get(path)).status).toBe(401);
    }
  });

  it('guards protected pages with role-aware redirects', async () => {
    const anonymous = await supertest(app).get('/admin');
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.location).toBe('/employee-login');

    const wrongRole = await agents.client.get('/admin');
    expect(wrongRole.status).toBe(302);
    expect(wrongRole.headers.location).toBe('/client');

    expect((await agents.admin.get('/admin')).status).toBe(200);
    expect((await agents.cashier.get('/customers')).status).toBe(200);
    expect((await agents.client.get('/profile')).status).toBe(200);
  });
});
