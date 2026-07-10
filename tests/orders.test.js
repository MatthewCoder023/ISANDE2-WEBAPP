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
