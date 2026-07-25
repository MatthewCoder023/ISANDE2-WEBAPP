const { setup, teardown, seedRoleAgents, createProduct } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

const stockOf = async (id) =>
  (await agents.admin.get(`/api/products/${id}`)).body.data.product.stock.quantity;

describe('placing orders', () => {
  it('prices orders server-side — client-sent prices are ignored', async () => {
    const product = await createProduct({ price: 500 });

    const res = await agents.client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 2, price: 1 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.order.total).toBe(1000);
    expect(res.body.data.order.items[0].price).toBe(500);
    expect(res.body.data.order.status).toBe('pending_payment');
  });

  it('reserves stock at placement and restores it on cancellation', async () => {
    const product = await createProduct({ stock: { quantity: 10, lowStockThreshold: 2 } });

    const order = (
      await agents.client.post('/api/orders').send({
        items: [{ productId: product.id, quantity: 4 }],
      })
    ).body.data.order;
    expect(await stockOf(product.id)).toBe(6);

    await agents.client.post(`/api/orders/${order.id}/cancel`);
    expect(await stockOf(product.id)).toBe(10);
  });

  it('rolls back earlier reservations when a later item lacks stock', async () => {
    const plenty = await createProduct({ stock: { quantity: 10, lowStockThreshold: 2 } });
    const scarce = await createProduct({ stock: { quantity: 2, lowStockThreshold: 1 } });

    const res = await agents.client.post('/api/orders').send({
      items: [
        { productId: plenty.id, quantity: 3 },
        { productId: scarce.id, quantity: 5 },
      ],
    });

    expect(res.status).toBe(409);
    expect(await stockOf(plenty.id)).toBe(10);
    expect(await stockOf(scarce.id)).toBe(2);
  });

  it('honors the online-ordering kill switch', async () => {
    const product = await createProduct();
    await agents.admin.patch('/api/settings').send({ acceptOnlineOrders: false });

    const blocked = await agents.client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(blocked.status).toBe(503);

    await agents.admin.patch('/api/settings').send({ acceptOnlineOrders: true });
    const allowed = await agents.client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(allowed.status).toBe(201);
  });
});

describe('order visibility', () => {
  it('lets clients see only their own orders', async () => {
    const list = await agents.client.get('/api/orders?limit=50');
    expect(list.status).toBe(200);
    // Every order in this suite so far was placed by this client.
    const others = await seedAnotherClientOrder();
    const refreshed = await agents.client.get('/api/orders?limit=50');
    const ids = refreshed.body.data.orders.map((o) => o.id);
    expect(ids).not.toContain(others.orderId);
  });

  async function seedAnotherClientOrder() {
    const { createUser, loginAgent } = require('./helpers');
    await createUser({ email: 'other-client@test.com' });
    const other = await loginAgent(app, 'other-client@test.com');
    const product = await createProduct();
    const res = await other.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 1 }],
    });
    return { orderId: res.body.data.order.id };
  }
});

describe('walk-in POS sales', () => {
  it('completes immediately with a transaction and correct change', async () => {
    const product = await createProduct({ price: 250 });

    const res = await agents.cashier.post('/api/orders/walk-in').send({
      items: [{ productId: product.id, quantity: 2 }],
      customerName: 'Aling Nena',
      payment: { method: 'cash', amountTendered: 600 },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.order.status).toBe('completed');
    expect(res.body.data.order.type).toBe('walk_in');
    expect(res.body.data.transaction.change).toBe(100);
  });

  it('appears in the transactions CSV export', async () => {
    const product = await createProduct({ price: 123 });
    const sale = await agents.cashier.post('/api/orders/walk-in').send({
      items: [{ productId: product.id, quantity: 1 }],
      payment: { method: 'gcash' },
    });
    const orderNumber = sale.body.data.order.orderNumber;

    const res = await agents.cashier.get('/api/transactions/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Date,Order Number,Method,Amount');
    expect(res.text).toContain(orderNumber);
  });

  it('rejects short cash before touching stock', async () => {
    const product = await createProduct({ price: 300, stock: { quantity: 8, lowStockThreshold: 2 } });

    const res = await agents.cashier.post('/api/orders/walk-in').send({
      items: [{ productId: product.id, quantity: 1 }],
      payment: { method: 'cash', amountTendered: 100 },
    });

    expect(res.status).toBe(422);
    expect(await stockOf(product.id)).toBe(8);
  });
});

describe('stale-order expiry', () => {
  const mongoose = require('mongoose');
  const Order = require('../src/models/Order');
  const orderService = require('../src/services/order.service');

  const backdate = (orderId, hoursAgo) =>
    Order.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(orderId) },
      { $set: { updatedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) } }
    );

  it('cancels idle pending-payment orders and restores their stock', async () => {
    const product = await createProduct({ stock: { quantity: 10, lowStockThreshold: 2 } });
    const res = await agents.client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 3 }],
    });
    const order = res.body.data.order;
    expect(await stockOf(product.id)).toBe(7);

    await backdate(order.id, 49);
    expect(await orderService.expireStaleOrders()).toBe(1);

    const after = (await agents.client.get(`/api/orders/${order.id}`)).body.data.order;
    expect(after.status).toBe('cancelled');
    expect(after.statusHistory.at(-1).note).toMatch(/Auto-cancelled/);
    expect(await stockOf(product.id)).toBe(10);
  });

  it('leaves fresh and active orders alone', async () => {
    const product = await createProduct({ stock: { quantity: 10, lowStockThreshold: 2 } });

    // Fresh pending_payment order: inside the window.
    const fresh = (
      await agents.client.post('/api/orders').send({
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).body.data.order;

    // Old order, but the customer chose cash on pickup — not pending_payment.
    const active = (
      await agents.client.post('/api/orders').send({
        items: [{ productId: product.id, quantity: 1 }],
      })
    ).body.data.order;
    await agents.client
      .post(`/api/orders/${active.id}/payment-method`)
      .send({ method: 'cash_on_pickup' });
    await backdate(active.id, 100);

    expect(await orderService.expireStaleOrders()).toBe(0);
    expect((await agents.client.get(`/api/orders/${fresh.id}`)).body.data.order.status).toBe(
      'pending_payment'
    );
    expect((await agents.client.get(`/api/orders/${active.id}`)).body.data.order.status).toBe(
      'preparing'
    );
  });
});

describe('dashboard tile deep links', () => {
  it('status=active returns exactly what the Active Orders tile counts', async () => {
    const product = await createProduct({ stock: { quantity: 20, lowStockThreshold: 2 } });
    const place = () =>
      agents.client
        .post('/api/orders')
        .send({ items: [{ productId: product.id, quantity: 1 }] })
        .then((r) => r.body.data.order);

    const stillOpen = await place();
    const toCancel = await place();
    await agents.client.post(`/api/orders/${toCancel.id}/cancel`);

    const [stats, active] = await Promise.all([
      agents.client.get('/api/orders/stats'),
      agents.client.get('/api/orders?status=active&limit=50'),
    ]);

    // The tile's number and the linked list must agree.
    expect(active.body.data.pagination.total).toBe(stats.body.data.stats.activeOrders);
    const ids = active.body.data.orders.map((o) => o.id);
    expect(ids).toContain(stillOpen.id);
    expect(ids).not.toContain(toCancel.id);
    expect(active.body.data.orders.every((o) => !['completed', 'cancelled'].includes(o.status))).toBe(true);
  });

  it('stock=alert returns exactly what the Low / Out of Stock tile counts', async () => {
    await createProduct({ stock: { quantity: 0, lowStockThreshold: 5 } }); // out
    await createProduct({ stock: { quantity: 3, lowStockThreshold: 5 } }); // low
    await createProduct({ stock: { quantity: 99, lowStockThreshold: 5 } }); // healthy

    const [stats, alert] = await Promise.all([
      agents.admin.get('/api/products/stats'),
      agents.admin.get('/api/products?stock=alert&limit=100'),
    ]);

    const expected = stats.body.data.stats.lowStock + stats.body.data.stats.outOfStock;
    expect(alert.body.data.pagination.total).toBe(expected);
    expect(
      alert.body.data.products.every((p) => p.stock.quantity <= p.stock.lowStockThreshold)
    ).toBe(true);
  });
});
