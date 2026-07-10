const { setup, teardown, seedRoleAgents, createProduct } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

describe('product catalog', () => {
  it('creates a product with an auto-generated SKU and an initial movement', async () => {
    const res = await agents.admin.post('/api/products').send({
      name: 'Coral Dream',
      category: 'interior',
      finish: 'satin',
      size: '4L',
      color: { name: 'Coral', hex: '#FF6F61' },
      price: 900,
      stock: { quantity: 10, lowStockThreshold: 3 },
    });

    expect(res.status).toBe(201);
    const product = res.body.data.product;
    expect(product.sku).toMatch(/^FC-INT-\d{4}$/);

    const movements = await agents.admin.get(`/api/products/${product.id}/movements`);
    expect(movements.body.data.movements).toHaveLength(1);
    expect(movements.body.data.movements[0]).toMatchObject({
      type: 'initial',
      quantity: 10,
      quantityAfter: 10,
    });
  });

  it('never lets an update touch sku or stock quantity', async () => {
    const product = await createProduct({ sku: 'LOCKED-01' });

    const res = await agents.admin
      .patch(`/api/products/${product.id}`)
      .send({ price: 150, sku: 'HACKED-01', stock: { quantity: 9999 } });

    expect(res.status).toBe(200);
    expect(res.body.data.product.sku).toBe('LOCKED-01');
    expect(res.body.data.product.stock.quantity).toBe(20);
    expect(res.body.data.product.price).toBe(150);
  });

  it('hides archived products from customers but not from staff', async () => {
    const product = await createProduct();
    await agents.admin.delete(`/api/products/${product.id}`);

    expect((await agents.client.get(`/api/products/${product.id}`)).status).toBe(404);
    expect((await agents.admin.get(`/api/products/${product.id}`)).status).toBe(200);
  });

  it('shapes customer responses: availability, but no raw stock numbers', async () => {
    await createProduct();
    const res = await agents.client.get('/api/products?limit=1');
    const product = res.body.data.products[0];

    expect(product.availability).toBeDefined();
    expect(product.stock).toBeUndefined();
    expect(product.isActive).toBeUndefined();
  });
});

describe('inventory integrity', () => {
  it('applies restocks and adjustments through the audit trail', async () => {
    const product = await createProduct({ stock: { quantity: 5, lowStockThreshold: 2 } });

    const restock = await agents.admin
      .post(`/api/products/${product.id}/stock`)
      .send({ type: 'restock', quantity: 7, reason: 'Delivery' });
    expect(restock.body.data.product.stock.quantity).toBe(12);

    const adjust = await agents.admin
      .post(`/api/products/${product.id}/stock`)
      .send({ type: 'adjustment', quantity: -2, reason: 'Damaged cans' });
    expect(adjust.body.data.product.stock.quantity).toBe(10);

    const history = await agents.admin.get(`/api/products/${product.id}/movements`);
    expect(history.body.data.movements.map((m) => m.type)).toEqual(['adjustment', 'restock']);
  });

  it('refuses adjustments that would drive stock negative', async () => {
    const product = await createProduct({ stock: { quantity: 3, lowStockThreshold: 1 } });

    const res = await agents.admin
      .post(`/api/products/${product.id}/stock`)
      .send({ type: 'adjustment', quantity: -10, reason: 'Oops' });
    expect(res.status).toBe(409);

    const check = await agents.admin.get(`/api/products/${product.id}`);
    expect(check.body.data.product.stock.quantity).toBe(3);
  });

  it('requires a reason for manual adjustments', async () => {
    const product = await createProduct();
    const res = await agents.admin
      .post(`/api/products/${product.id}/stock`)
      .send({ type: 'adjustment', quantity: -1 });
    expect(res.status).toBe(422);
  });
});

describe('color matching', () => {
  it('ranks the perceptually closest paint first', async () => {
    await createProduct({ name: 'Almost Coral', color: { name: 'Coral', hex: '#FF6F61' } });
    await createProduct({ name: 'Deep Navy', color: { name: 'Navy', hex: '#1B4F72' } });

    const res = await agents.client.get('/api/products/match?hex=FF7060&limit=8');
    expect(res.status).toBe(200);

    const matches = res.body.data.matches;
    expect(matches[0].product.color.hex).toBe('#FF6F61');
    expect(matches[0].matchPercent).toBeGreaterThan(90);

    // Distances are sorted ascending, and navy ranks far behind coral.
    const deltas = matches.map((m) => m.deltaE);
    expect([...deltas].sort((a, b) => a - b)).toEqual(deltas);
    const navy = matches.find((m) => m.product.name === 'Deep Navy');
    expect(navy.deltaE).toBeGreaterThan(matches[0].deltaE + 20);
  });

  it('rejects malformed hex values', async () => {
    expect((await agents.client.get('/api/products/match?hex=red')).status).toBe(422);
  });
});
