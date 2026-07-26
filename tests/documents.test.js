const supertest = require('supertest');
const { setup, teardown, seedRoleAgents, createProduct, createUser, loginAgent } = require('./helpers');
const { documentCode } = require('../src/services/document.service');
const Order = require('../src/models/Order');

let app;
let agents;

/** supertest only buffers types it recognises; xlsx needs collecting by hand. */
const binaryParser = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

async function placeOrder(agent = agents.client, price = 400, quantity = 2) {
  const product = await createProduct({ price });
  const res = await agent.post('/api/orders').send({
    items: [{ productId: product.id, quantity }],
  });
  return res.body.data.order;
}

describe('invoice PDF', () => {
  it('serves a real PDF to the order owner', async () => {
    const order = await placeOrder();
    const res = await agents.client.get(`/api/orders/${order.id}/invoice.pdf`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`invoice-${order.orderNumber}.pdf`);
    // A PDF starts with %PDF- and ends with the EOF marker.
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    expect(res.body.toString('latin1')).toContain('%%EOF');
  });

  it('fits on a single page for an ordinary order', async () => {
    const order = await placeOrder();
    const res = await agents.client.get(`/api/orders/${order.id}/invoice.pdf`);
    const pages = (res.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBe(1);
  });

  it('is staff-readable but private from other customers', async () => {
    const order = await placeOrder();
    expect((await agents.cashier.get(`/api/orders/${order.id}/invoice.pdf`)).status).toBe(200);

    await createUser({ email: 'pdf-snoop@test.com' });
    const snoop = await loginAgent(app, 'pdf-snoop@test.com');
    expect((await snoop.get(`/api/orders/${order.id}/invoice.pdf`)).status).toBe(404);
  });
});

describe('document verification', () => {
  it('accepts the code printed on an untouched document', async () => {
    const order = await placeOrder();
    const record = await Order.findById(order.id);
    const code = documentCode(record);

    const res = await supertest(app).get(
      `/api/orders/verify?order=${order.orderNumber}&code=${code}`
    );

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.total).toBe(order.total);
  });

  it('needs no login — whoever holds the paper can check it', async () => {
    const order = await placeOrder();
    const code = documentCode(await Order.findById(order.id));
    const anonymous = supertest(app); // no session cookie at all
    const res = await anonymous.get(`/api/orders/verify?order=${order.orderNumber}&code=${code}`);
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });

  it('rejects a document whose figures were altered after download', async () => {
    const order = await placeOrder();
    const record = await Order.findById(order.id);
    const codeAtDownload = documentCode(record);

    // Someone edits the total in the downloaded copy — the server's facts
    // no longer produce that code.
    record.total = 1;
    const codeNow = documentCode(record);
    expect(codeNow).not.toBe(codeAtDownload);

    const res = await supertest(app).get(
      `/api/orders/verify?order=${order.orderNumber}&code=${'0'.repeat(12)}`
    );
    expect(res.status).toBe(404);
    expect(res.body.data.valid).toBe(false);
  });

  it('survives the order moving on: status is not part of the code', async () => {
    const order = await placeOrder();
    const code = documentCode(await Order.findById(order.id));

    await agents.client
      .post(`/api/orders/${order.id}/payment-method`)
      .send({ method: 'cash_on_pickup' });

    const res = await supertest(app).get(
      `/api/orders/verify?order=${order.orderNumber}&code=${code}`
    );
    expect(res.body.data.valid).toBe(true);
  });
});

describe('exports', () => {
  it('gives the order export the context an invoice shows', async () => {
    const order = await placeOrder(agents.client, 250, 3);
    const res = await agents.client.get(`/api/orders/${order.id}/export.csv`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const csv = res.text;
    for (const section of ['INVOICE', 'BILLED TO', 'ITEMS', 'TOTALS']) {
      expect(csv).toContain(section);
    }
    expect(csv).toContain(order.orderNumber);
    expect(csv).toContain('Verification Code');
    expect(csv).toContain('Item,SKU,Unit Price,Quantity,Amount');
    expect(csv).toContain(String(order.total));
  });

  it('keeps the flat transactions CSV exactly as it was', async () => {
    const res = await agents.cashier.get('/api/transactions/export');
    expect(res.status).toBe(200);
    // First line is still the bare header row, no document sections.
    expect(res.text.split('\r\n')[0]).toBe(
      '﻿Date,Order Number,Method,Amount,Amount Tendered,Change,Received By'
    );
  });

  it('produces a locked workbook for staff, and refuses customers', async () => {
    const res = await agents.cashier
      .get('/api/transactions/export.xlsx')
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    // xlsx files are zip archives — they start with PK.
    expect(res.body.slice(0, 2).toString()).toBe('PK');

    expect((await agents.client.get('/api/transactions/export.xlsx')).status).toBe(403);
  });
});

describe('sales report window', () => {
  it('honours an explicit from/to range', async () => {
    const res = await agents.admin.get('/api/reports/sales?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(31);
    // Reported as calendar dates: the raw timestamps serialise as UTC and
    // would read as the day before in any positive-offset timezone.
    expect(res.body.data.range).toEqual({ from: '2026-03-01', to: '2026-03-31' });
  });

  it('falls back to trailing days when the range is missing or backwards', async () => {
    const plain = await agents.admin.get('/api/reports/sales?days=7');
    expect(plain.body.data.days).toBe(7);

    const backwards = await agents.admin.get('/api/reports/sales?from=2026-03-31&to=2026-03-01');
    expect(backwards.body.data.days).toBe(30); // default window, not a negative one
  });

  it('exports the report for the window on screen, admin only', async () => {
    const res = await agents.admin.get('/api/reports/sales/export?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    for (const section of ['SALES REPORT', 'TOTALS', 'BY PAYMENT METHOD', 'TOP PRODUCTS']) {
      expect(res.text).toContain(section);
    }
    expect(res.text).toContain('2026-03-01 to 2026-03-31');

    expect((await agents.cashier.get('/api/reports/sales/export')).status).toBe(403);
  });
});
