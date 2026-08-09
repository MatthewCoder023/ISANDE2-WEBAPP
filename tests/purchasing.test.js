const { setup, teardown, seedRoleAgents, createProduct } = require('./helpers');
const Supplier = require('../src/models/Supplier');
const Product = require('../src/models/Product');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

const makeSupplier = (overrides = {}) =>
  Supplier.create({ name: 'Acme Paints', phone: '0917 555 0001', ...overrides });

/** Raises a PO for one product and returns { po, product, supplier }. */
async function makePo({ quantity = 10, unitCost = 500, stock = 0 } = {}) {
  const supplier = await makeSupplier({ name: `Supplier ${Math.random()}` });
  const product = await createProduct({
    price: 900,
    stock: { quantity: stock, lowStockThreshold: 5 },
  });

  const res = await agents.admin.post('/api/purchase-orders').send({
    supplierId: supplier.id,
    items: [{ productId: product.id, quantity, unitCost }],
  });

  return { res, po: res.body.data?.purchaseOrder, product, supplier };
}

describe('purchase orders', () => {
  it('prices the order from the catalogue and numbers it', async () => {
    const { res, po } = await makePo({ quantity: 4, unitCost: 250 });

    expect(res.status).toBe(201);
    expect(po.poNumber).toMatch(/^PO-\d{8}-\d{4}$/);
    expect(po.status).toBe('draft');
    // Name and SKU come from the catalogue, not the request.
    expect(po.items[0].name).toBeTruthy();
    expect(po.items[0].sku).toMatch(/^TEST-/);
    expect(po.items[0].lineTotal).toBe(1000);
    expect(po.total).toBe(1000);
  });

  it('falls back to the product price when no unit cost is quoted', async () => {
    const supplier = await makeSupplier({ name: 'Default Cost Co' });
    const product = await createProduct({ price: 640 });

    const res = await agents.admin
      .post('/api/purchase-orders')
      .send({ supplierId: supplier.id, items: [{ productId: product.id, quantity: 3 }] });

    expect(res.body.data.purchaseOrder.items[0].unitCost).toBe(640);
    expect(res.body.data.purchaseOrder.total).toBe(1920);
  });

  it('merges duplicate lines for the same product', async () => {
    const supplier = await makeSupplier({ name: 'Duplicate Lines Ltd' });
    const product = await createProduct({ price: 100 });

    const res = await agents.admin.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [
        { productId: product.id, quantity: 2, unitCost: 100 },
        { productId: product.id, quantity: 3, unitCost: 100 },
      ],
    });

    expect(res.body.data.purchaseOrder.items).toHaveLength(1);
    expect(res.body.data.purchaseOrder.items[0].quantityOrdered).toBe(5);
  });

  /**
   * The invariant this whole module exists to protect: ordering is a promise,
   * not a delivery. Nothing reaches the shelf until someone confirms it did.
   */
  it('moves no stock when the order is raised', async () => {
    const { po, product } = await makePo({ quantity: 10, stock: 4 });

    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(4);

    const movements = await agents.admin.get(`/api/products/${product.id}/movements`);
    expect(movements.body.data.movements).toHaveLength(0);
    expect(po.items[0].quantityReceived).toBeNull();
  });

  it('adds stock on receipt, using the quantity that actually arrived', async () => {
    const { po, product } = await makePo({ quantity: 10, stock: 4 });

    // Eight of the ten turned up.
    const received = await agents.admin
      .post(`/api/purchase-orders/${po.id}/receive`)
      .send({ items: [{ sku: po.items[0].sku, quantityReceived: 8 }] });

    expect(received.status).toBe(200);
    expect(received.body.data.purchaseOrder.status).toBe('received');
    expect(received.body.data.purchaseOrder.items[0].quantityReceived).toBe(8);

    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(12); // 4 + 8, not 4 + 10

    const movements = await agents.admin.get(`/api/products/${product.id}/movements`);
    expect(movements.body.data.movements).toHaveLength(1);
    expect(movements.body.data.movements[0]).toMatchObject({ type: 'restock', quantity: 8 });
    expect(movements.body.data.movements[0].reason).toContain(po.poNumber);
  });

  it('records no movement for a line where nothing arrived', async () => {
    const { po, product } = await makePo({ quantity: 6, stock: 2 });

    await agents.admin
      .post(`/api/purchase-orders/${po.id}/receive`)
      .send({ items: [{ sku: po.items[0].sku, quantityReceived: 0 }] });

    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(2);
    const movements = await agents.admin.get(`/api/products/${product.id}/movements`);
    expect(movements.body.data.movements).toHaveLength(0);
  });

  it('refuses to receive more than was ordered', async () => {
    const { po, product } = await makePo({ quantity: 5, stock: 1 });

    const res = await agents.admin
      .post(`/api/purchase-orders/${po.id}/receive`)
      .send({ items: [{ sku: po.items[0].sku, quantityReceived: 9 }] });

    expect(res.status).toBe(422);
    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(1);
  });

  it('cannot be received twice, so stock is never double counted', async () => {
    const { po, product } = await makePo({ quantity: 5, stock: 0 });
    const line = [{ sku: po.items[0].sku, quantityReceived: 5 }];

    await agents.admin.post(`/api/purchase-orders/${po.id}/receive`).send({ items: line });
    const second = await agents.admin
      .post(`/api/purchase-orders/${po.id}/receive`)
      .send({ items: line });

    expect(second.status).toBe(409);
    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(5);
  });

  it('cancels before delivery and then refuses receipt', async () => {
    const { po, product } = await makePo({ quantity: 5, stock: 3 });

    const cancelled = await agents.admin
      .post(`/api/purchase-orders/${po.id}/cancel`)
      .send({ reason: 'Supplier out of stock' });
    expect(cancelled.body.data.purchaseOrder.status).toBe('cancelled');

    const receive = await agents.admin
      .post(`/api/purchase-orders/${po.id}/receive`)
      .send({ items: [{ sku: po.items[0].sku, quantityReceived: 5 }] });
    expect(receive.status).toBe(409);

    const after = await Product.findById(product.id);
    expect(after.stock.quantity).toBe(3);
  });

  /** A customer's bespoke paint is made in-house; no supplier sells it. */
  it('refuses to put a custom mix on a supplier order', async () => {
    const supplier = await makeSupplier({ name: 'No Custom Co' });
    const custom = await createProduct({ price: 800, isCustom: true });

    const res = await agents.admin
      .post('/api/purchase-orders')
      .send({ supplierId: supplier.id, items: [{ productId: custom.id, quantity: 1 }] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/in-house/i);
  });

  it('renders a purchase order document', async () => {
    const { po } = await makePo();
    const res = await agents.admin.get(`/api/purchase-orders/${po.id}/document.pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('procurement access', () => {
  it.each([
    ['cashier', 'cashier'],
    ['paint mixer', 'paint_mixer'],
    ['customer', 'client'],
  ])('keeps %s out of purchase orders and suppliers', async (_label, key) => {
    expect((await agents[key].get('/api/purchase-orders')).status).toBe(403);
    expect((await agents[key].get('/api/suppliers')).status).toBe(403);
    expect((await agents[key].post('/api/suppliers').send({ name: 'Sneaky' })).status).toBe(403);
  });
});

describe('suppliers', () => {
  it('archives rather than deletes, so purchase order history keeps both ends', async () => {
    const { po, supplier } = await makePo();

    const res = await agents.admin.delete(`/api/suppliers/${supplier.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.supplier.isActive).toBe(false);

    // The order still names them.
    const detail = await agents.admin.get(`/api/purchase-orders/${po.id}`);
    expect(detail.body.data.purchaseOrder.supplierName).toBe(supplier.name);
  });

  it('will not raise an order against an archived supplier', async () => {
    const supplier = await makeSupplier({ name: 'Archived Co', isActive: false });
    const product = await createProduct();

    const res = await agents.admin
      .post('/api/purchase-orders')
      .send({ supplierId: supplier.id, items: [{ productId: product.id, quantity: 1 }] });

    expect(res.status).toBe(404);
  });
});

/**
 * The receipt is generated from the transaction rather than stored, so the
 * guarantees worth testing are that one exists for every completed sale,
 * that admin and cashier reach the identical document, and that a customer
 * never reaches this staff-facing endpoint.
 */
describe('sales receipts', () => {
  /**
   * Documents carry a verification link built from APP_URL, falling back to
   * the request's own host. Supertest binds a fresh ephemeral port per
   * request, so without this the link — and the QR encoding it — would
   * differ between two calls for reasons no real deployment has.
   */
  const previousAppUrl = process.env.APP_URL;
  beforeAll(() => {
    process.env.APP_URL = 'http://localhost:3000';
  });
  afterAll(() => {
    process.env.APP_URL = previousAppUrl;
  });

  async function completedSale() {
    const product = await createProduct({ price: 500, stock: { quantity: 10, lowStockThreshold: 2 } });
    const sale = await agents.cashier.post('/api/orders/walk-in').send({
      items: [{ productId: product.id, quantity: 2 }],
      customerName: 'Walk-in Customer',
      payment: { method: 'cash', amountTendered: 1000 },
    });
    return sale.body.data.transaction;
  }

  it('gives every completed sale a receipt number', async () => {
    const transaction = await completedSale();
    expect(transaction.receiptNumber).toMatch(/^OR-\d{8}-\d{4}$/);
  });

  it('serves the same document to the cashier and the admin', async () => {
    const transaction = await completedSale();

    const asCashier = await agents.cashier.get(`/api/transactions/${transaction.id}/receipt.pdf`);
    const asAdmin = await agents.admin.get(`/api/transactions/${transaction.id}/receipt.pdf`);

    expect(asCashier.status).toBe(200);
    expect(asAdmin.status).toBe(200);
    expect(asCashier.headers['content-type']).toBe('application/pdf');
    expect(asCashier.body.subarray(0, 5).toString()).toBe('%PDF-');

    // Byte-for-byte identical: one receipt per transaction, not one per role.
    expect(Buffer.compare(asCashier.body, asAdmin.body)).toBe(0);
  });

  it('keeps the same receipt number on every later visit', async () => {
    const transaction = await completedSale();

    await agents.admin.get(`/api/transactions/${transaction.id}/receipt.pdf`);
    const list = await agents.admin.get('/api/transactions?limit=50');
    const row = list.body.data.transactions.find((t) => t.id === transaction.id);

    expect(row.receiptNumber).toBe(transaction.receiptNumber);
  });

  it('keeps customers away from the staff receipt endpoint', async () => {
    const transaction = await completedSale();
    const res = await agents.client.get(`/api/transactions/${transaction.id}/receipt.pdf`);
    expect(res.status).toBe(403);
  });
});
