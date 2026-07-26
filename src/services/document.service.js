const crypto = require('crypto');

/**
 * Tamper-evidence for exported documents.
 *
 * Nothing downloadable can be made uneditable — a PDF or spreadsheet can
 * always be altered by whoever holds it. What can be done is make an
 * alteration *detectable*: every document carries a short code derived from
 * the order's financial facts and a server-side secret, and anyone holding
 * the document can ask the server whether the two still agree.
 *
 * Only immutable facts go into the code. Status deliberately does not — an
 * invoice downloaded while an order was pending must still verify after it
 * ships.
 */

const SECRET = () => process.env.DOCUMENT_SECRET || process.env.SESSION_SECRET || 'insecure-dev';

/** The exact financial claims the document makes. */
function factsOf(order) {
  const lines = order.items
    .map((item) => `${item.sku || item.name}x${item.quantity}@${item.price.toFixed(2)}`)
    .join(';');

  return [
    order.orderNumber,
    new Date(order.createdAt).toISOString(),
    order.customerName || '',
    order.subtotal.toFixed(2),
    order.total.toFixed(2),
    lines,
  ].join('|');
}

/** Short, human-transcribable code printed on the document. */
function documentCode(order) {
  return crypto
    .createHmac('sha256', SECRET())
    .update(factsOf(order))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
}

/**
 * Confirms a presented code still matches what the order says today.
 * Compared in constant time so the endpoint can't be used as an oracle.
 */
function verifyCode(order, presented) {
  const expected = documentCode(order);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(presented || '').toUpperCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { documentCode, verifyCode };
