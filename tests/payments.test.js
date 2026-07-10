const { setup, teardown, seedRoleAgents, createProduct, createUser, loginAgent } = require('./helpers');

let app;
let agents;

beforeAll(async () => {
  app = await setup();
  ({ agents } = await seedRoleAgents(app));
});
afterAll(teardown);

const PNG_BUFFER = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function placeOrder(agent = agents.client) {
  const product = await createProduct({ price: 400 });
  const res = await agent.post('/api/orders').send({
    items: [{ productId: product.id, quantity: 1 }],
  });
  return res.body.data.order;
}

describe('cash on pickup', () => {
  it('skips verification and goes straight to preparing', async () => {
    const order = await placeOrder();

    const res = await agents.client
      .post(`/api/orders/${order.id}/payment-method`)
      .send({ method: 'cash_on_pickup' });

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('preparing');
    expect(res.body.data.order.payment.method).toBe('cash_on_pickup');
  });

  it('takes payment at handover and records the transaction', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/payment-method`)
      .send({ method: 'cash_on_pickup' });
    await agents.cashier.post(`/api/orders/${order.id}/ready`);

    const res = await agents.cashier
      .post(`/api/orders/${order.id}/complete`)
      .send({ method: 'cash', amountTendered: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('completed');
    expect(res.body.data.transaction.change).toBe(100);
  });
});

describe('GCash proof verification', () => {
  it('walks the full flow: upload, reject, re-upload, verify, complete', async () => {
    const order = await placeOrder();

    // Upload proof -> pending_verification
    const upload = await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });
    expect(upload.status).toBe(200);
    expect(upload.body.data.order.status).toBe('pending_verification');

    // Completing is blocked while verification is pending
    const blocked = await agents.cashier.post(`/api/orders/${order.id}/complete`).send({});
    expect(blocked.status).toBe(409);

    // Reject -> back to pending_payment with the reason recorded
    const reject = await agents.cashier
      .post(`/api/orders/${order.id}/reject-payment`)
      .send({ reason: 'Amount not visible' });
    expect(reject.body.data.order.status).toBe('pending_payment');
    expect(reject.body.data.order.payment.rejectedReason).toBe('Amount not visible');

    // Re-upload and verify -> paid, transaction recorded
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt2.png', contentType: 'image/png' });
    const verify = await agents.cashier.post(`/api/orders/${order.id}/verify-payment`);
    expect(verify.status).toBe(200);
    expect(verify.body.data.order.status).toBe('payment_verified');
    expect(verify.body.data.transaction.method).toBe('gcash');
    expect(verify.body.data.transaction.amount).toBe(400);

    // Prepare -> ready -> complete WITHOUT a second payment
    await agents.cashier.post(`/api/orders/${order.id}/prepare`);
    await agents.cashier.post(`/api/orders/${order.id}/ready`);
    const complete = await agents.cashier.post(`/api/orders/${order.id}/complete`).send({});
    expect(complete.status).toBe(200);
    expect(complete.body.data.order.status).toBe('completed');

    // The whole journey is in the status history
    const statuses = complete.body.data.order.statusHistory.map((h) => h.status);
    expect(statuses).toEqual([
      'pending_payment',
      'pending_verification',
      'pending_payment',
      'pending_verification',
      'payment_verified',
      'preparing',
      'ready',
      'completed',
    ]);
  });

  it('rejects non-image proof uploads', async () => {
    const order = await placeOrder();
    const res = await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', Buffer.from('not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(422);
  });

  it('keeps proofs private: other customers cannot see them', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    await createUser({ email: 'snoop@test.com' });
    const snoop = await loginAgent(app, 'snoop@test.com');
    expect((await snoop.get(`/api/orders/${order.id}/proof`)).status).toBe(404);

    expect((await agents.cashier.get(`/api/orders/${order.id}/proof`)).status).toBe(200);
  });

  it('blocks client cancellation once payment is in motion', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    const res = await agents.client.post(`/api/orders/${order.id}/cancel`);
    expect(res.status).toBe(409);
  });
});
