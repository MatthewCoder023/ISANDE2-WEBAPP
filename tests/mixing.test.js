const { setup, teardown, seedRoleAgents, createUser, loginAgent } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

async function createRequest(agent = agents.client, hex = '#88AACC') {
  const res = await agent.post('/api/mixing/requests').send({
    targetColor: { hex, name: 'Test Shade' },
    quantity: 1,
  });
  expect(res.status).toBe(201);
  return res.body.data.request;
}

describe('mix request lifecycle', () => {
  it('walks queued -> mixing -> completed while recording a new formula', async () => {
    const request = await createRequest();

    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/start`);

    const complete = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({
        newFormula: {
          name: 'Hazy Sky (test)',
          colorHex: '#88AACC',
          components: [{ name: 'White base', amount: 3.5, unit: 'mL' }],
        },
        mixerNotes: 'Matched under daylight',
      });

    expect(complete.status).toBe(200);
    expect(complete.body.data.request.status).toBe('completed');
    expect(complete.body.data.formula.timesUsed).toBe(1);
  });

  it('increments timesUsed when reusing a formula, and refuses archived ones', async () => {
    const formulaId = (await agents.paint_mixer.get('/api/formulas?search=Hazy')).body.data
      .formulas[0].id;

    const second = await createRequest();
    const reuse = await agents.paint_mixer
      .post(`/api/mixing/requests/${second.id}/complete`)
      .send({ formulaId });
    expect(reuse.body.data.formula.timesUsed).toBe(2);

    await agents.paint_mixer.delete(`/api/formulas/${formulaId}`);
    const third = await createRequest();
    const blocked = await agents.paint_mixer
      .post(`/api/mixing/requests/${third.id}/complete`)
      .send({ formulaId });
    expect(blocked.status).toBe(400);
  });

  it('lets clients cancel only while queued', async () => {
    const request = await createRequest();
    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/start`);

    const res = await agents.client.post(`/api/mixing/requests/${request.id}/cancel`);
    expect(res.status).toBe(409);
  });

  it('scopes clients to their own requests', async () => {
    await createUser({ email: 'other-mixer-client@test.com' });
    const other = await loginAgent(app, 'other-mixer-client@test.com');
    const foreign = await createRequest(other, '#112233');

    const list = await agents.client.get('/api/mixing/requests?limit=50');
    const ids = list.body.data.requests.map((r) => r.id);
    expect(ids).not.toContain(foreign.id);

    // Direct access to someone else's request is a 404, not a 403 leak.
    expect((await agents.client.get(`/api/mixing/requests/${foreign.id}`)).status).toBe(404);
  });

  it('rejects invalid target colors', async () => {
    const res = await agents.client.post('/api/mixing/requests').send({
      targetColor: { hex: 'blue' },
    });
    expect(res.status).toBe(422);
  });
});

describe('custom mix becomes purchasable', () => {
  const Product = require('../src/models/Product');

  it('publishes a priced, customer-reserved product when the mix completes', async () => {
    const request = await createRequest(agents.client, '#123456');

    const complete = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({ mixerNotes: 'Two coats recommended' });

    expect(complete.status).toBe(200);
    const { readyProduct, request: done } = complete.body.data;

    // Default quote = configured base price + mixing surcharge (750 + 150).
    expect(done.unitPrice).toBe(900);
    expect(readyProduct.price).toBe(900);
    expect(readyProduct.isCustom).toBe(true);
    expect(readyProduct.color.hex).toBe('#123456');
    expect(readyProduct.stock.quantity).toBe(request.quantity);
    expect(done.readyProduct).toBe(readyProduct.id);

    // The mixed batch enters the stock audit trail like any opening stock.
    const movements = await agents.admin.get(`/api/products/${readyProduct.id}/movements`);
    expect(movements.body.data.movements[0].type).toBe('initial');
  });

  it('honours a price the mixer sets by hand', async () => {
    const request = await createRequest(agents.client, '#654321');
    const res = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({ unitPrice: 1234.5 });

    expect(res.body.data.readyProduct.price).toBe(1234.5);
    expect(res.body.data.request.unitPrice).toBe(1234.5);
  });

  it('offers the finished mix to its owner and no one else', async () => {
    const request = await createRequest(agents.client, '#0AB0AB');
    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/complete`).send({});

    const ready = await agents.client.get('/api/mixing/ready');
    expect(ready.status).toBe(200);
    const mine = ready.body.data.items.find((i) => i.requestId === request.id);
    expect(mine).toBeDefined();
    expect(mine.product.color.hex).toBe('#0AB0AB');

    await createUser({ email: 'nosy@test.com' });
    const nosy = await loginAgent(app, 'nosy@test.com');
    const theirs = await nosy.get('/api/mixing/ready');
    expect(theirs.body.data.items).toHaveLength(0);
  });

  it('keeps custom paints out of everyone else\'s catalogue', async () => {
    const request = await createRequest(agents.client, '#FEDCBA');
    const complete = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({});
    const customId = complete.body.data.readyProduct.id;

    // The owner sees it in their catalogue...
    const ownerList = await agents.client.get('/api/products?limit=100');
    expect(ownerList.body.data.products.map((p) => p.id)).toContain(customId);

    // ...another customer sees neither the listing nor the product itself.
    await createUser({ email: 'stranger@test.com' });
    const stranger = await loginAgent(app, 'stranger@test.com');
    const strangerList = await stranger.get('/api/products?limit=100');
    expect(strangerList.body.data.products.map((p) => p.id)).not.toContain(customId);
    expect((await stranger.get(`/api/products/${customId}`)).status).toBe(404);

    // And it is never suggested as a colour match.
    const match = await stranger.get('/api/products/match?hex=FEDCBA');
    expect(match.body.data.matches.map((m) => m.product.id)).not.toContain(customId);
  });

  it('acknowledges once, so removing it from the cart sticks', async () => {
    const request = await createRequest(agents.client, '#ABCDEF');
    await agents.paint_mixer.post(`/api/mixing/requests/${request.id}/complete`).send({});

    const ack = await agents.client
      .post('/api/mixing/ready/ack')
      .send({ requestIds: [request.id] });
    expect(ack.body.data.acknowledged).toBe(1);

    const after = await agents.client.get('/api/mixing/ready');
    expect(after.body.data.items.map((i) => i.requestId)).not.toContain(request.id);
  });

  it('lets the customer actually order the finished mix', async () => {
    const request = await createRequest(agents.client, '#C0FFEE');
    const complete = await agents.paint_mixer
      .post(`/api/mixing/requests/${request.id}/complete`)
      .send({ unitPrice: 500 });
    const productId = complete.body.data.readyProduct.id;

    const order = await agents.client
      .post('/api/orders')
      .send({ items: [{ productId, quantity: 1 }] });

    expect(order.status).toBe(201);
    expect(order.body.data.order.total).toBe(500);
    expect(order.body.data.order.items[0].name).toContain('Custom Mix');

    // Stock for the one-off batch is consumed by the sale.
    const product = await Product.findById(productId);
    expect(product.stock.quantity).toBe(request.quantity - 1);
  });
});
