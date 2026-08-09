const fs = require('fs');
const path = require('path');
const { setup, teardown, seedRoleAgents, createProduct, createUser, loginAgent } = require('./helpers');
const { PROOFS_DIR } = require('../src/config/uploads');
const { sweepOrphanedProofs } = require('../src/services/order.service');
const Order = require('../src/models/Order');

/**
 * The stored filename is deliberately absent from API responses — it is a
 * server-side storage detail — so these tests read it where it actually
 * lives.
 */
const storedProofName = async (orderId) =>
  (await Order.findById(orderId).select('payment.proof.filename')).payment.proof.filename;

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

  it('stores proofs under server-generated names, never client input', async () => {
    const before = new Set(fs.readdirSync(PROOFS_DIR));
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: '../../../evil.png', contentType: 'image/png' });

    // The stored file is a UUID + whitelisted extension — nothing from
    // the request (order id, original filename) reaches the filesystem.
    const added = fs.readdirSync(PROOFS_DIR).filter((f) => !before.has(f));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^[0-9a-f-]{36}\.(jpg|png|webp)$/);
  });

  it('rejects a malformed order id before writing any file', async () => {
    const before = fs.readdirSync(PROOFS_DIR).length;
    const res = await agents.client
      .post('/api/orders/..%2F..%2Fetc/proof')
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(fs.readdirSync(PROOFS_DIR).length).toBe(before);
  });

  it('rejects files that only claim to be images', async () => {
    const before = fs.readdirSync(PROOFS_DIR).length;
    const order = await placeOrder();

    // Declared MIME says PNG, but the bytes are HTML — the magic-byte
    // check must reject it and leave nothing on disk.
    const res = await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', Buffer.from('<html>not an image</html>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(422);
    expect(fs.readdirSync(PROOFS_DIR).length).toBe(before);
  });

  it('cleans up the uploaded file when the order rejects it', async () => {
    const before = fs.readdirSync(PROOFS_DIR).length;
    // Well-formed but nonexistent order id: multer writes the file first,
    // then the 404 must remove it again.
    const res = await agents.client
      .post('/api/orders/64b000000000000000000000/proof')
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    expect(res.status).toBe(404);
    expect(fs.readdirSync(PROOFS_DIR).length).toBe(before);
  });

  it('says so plainly when the stored proof file has gone missing', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    // Exactly what an ephemeral filesystem does between deploys: the order
    // still names its proof, but the image behind it is gone.
    fs.unlinkSync(path.join(PROOFS_DIR, await storedProofName(order.id)));

    const res = await agents.cashier.get(`/api/orders/${order.id}/proof`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no longer available/i);
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

describe('order notifications', () => {
  const { outbox } = require('../src/services/mail.service');

  it('emails the customer at verification, rejection, and pickup-ready', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    outbox.length = 0;
    await agents.cashier
      .post(`/api/orders/${order.id}/reject-payment`)
      .send({ reason: 'Blurry screenshot' });
    expect(outbox.at(-1).subject).toContain('Action needed');
    expect(outbox.at(-1).text).toContain('Blurry screenshot');

    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt2.png', contentType: 'image/png' });
    await agents.cashier.post(`/api/orders/${order.id}/verify-payment`);
    expect(outbox.at(-1).subject).toContain('Payment confirmed');
    expect(outbox.at(-1).to).toBe('client@test.com');

    await agents.cashier.post(`/api/orders/${order.id}/prepare`);
    await agents.cashier.post(`/api/orders/${order.id}/ready`);
    expect(outbox.at(-1).subject).toContain('Ready for pickup');
    expect(outbox.at(-1).text).toContain(`/client/track?order=${order.id}`);
  });
});

/**
 * Proof files and the orders that name them are two separate facts, and
 * they drift apart. The sweep is what brings them back together — but only
 * ever in the safe direction.
 */
describe('orphaned proof sweep', () => {
  const ageFile = (name, hours) => {
    const when = new Date(Date.now() - hours * 60 * 60 * 1000);
    fs.utimesSync(path.join(PROOFS_DIR, name), when, when);
  };

  it('deletes an old file no order refers to', async () => {
    fs.writeFileSync(path.join(PROOFS_DIR, 'stray.png'), PNG_BUFFER);
    ageFile('stray.png', 48);

    const deleted = await sweepOrphanedProofs();

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(PROOFS_DIR, 'stray.png'))).toBe(false);
  });

  /**
   * The race the grace period exists for: multer writes the file before the
   * order naming it is saved, so for a moment a perfectly good proof is
   * indistinguishable from an orphan. Sweeping it would destroy a payment
   * record mid-request.
   */
  it('leaves a just-written file alone, even though nothing references it yet', async () => {
    fs.writeFileSync(path.join(PROOFS_DIR, 'in-flight.png'), PNG_BUFFER);

    await sweepOrphanedProofs();

    expect(fs.existsSync(path.join(PROOFS_DIR, 'in-flight.png'))).toBe(true);
    fs.unlinkSync(path.join(PROOFS_DIR, 'in-flight.png'));
  });

  it('never touches a file an order still refers to, however old', async () => {
    const order = await placeOrder();
    await agents.client
      .post(`/api/orders/${order.id}/proof`)
      .attach('proof', PNG_BUFFER, { filename: 'receipt.png', contentType: 'image/png' });

    const stored = await storedProofName(order.id);
    ageFile(stored, 24 * 365); // a year old, and still evidence

    await sweepOrphanedProofs();

    expect(fs.existsSync(path.join(PROOFS_DIR, stored))).toBe(true);
    expect((await agents.cashier.get(`/api/orders/${order.id}/proof`)).status).toBe(200);
  });
});
