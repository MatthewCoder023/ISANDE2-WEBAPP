const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const Setting = require('../models/Setting');
const { documentCode } = require('./document.service');
const { ORDER_STATUS } = require('../constants/orders');
const { PO_STATUS_LABELS } = require('../constants/purchasing');

/**
 * Server-rendered sales invoice PDF.
 *
 * The on-screen sales invoice stays the browser-print path; this produces the
 * same document as a real file, for emailing, archiving and handing over.
 * The layout is authored here rather than rendered from the HTML because
 * a headless browser would add hundreds of megabytes to the deployment —
 * the tradeoff is that this file and invoice.css must be kept in step.
 *
 * Currency prints as "PHP" rather than ₱: pdfkit's built-in fonts use
 * WinAnsi encoding, which has no peso glyph, and embedding a font would
 * tie the build to a machine that has one.
 */

const LOGO_PATH = path.join(__dirname, '..', '..', 'public', 'images', 'logo.png');

const STATUS_LABELS = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'Pending Payment',
  [ORDER_STATUS.PENDING_VERIFICATION]: 'Pending Verification',
  [ORDER_STATUS.PAYMENT_VERIFIED]: 'Payment Verified',
  [ORDER_STATUS.PREPARING]: 'Preparing Order',
  [ORDER_STATUS.READY]: 'Ready for Pickup',
  [ORDER_STATUS.COMPLETED]: 'Completed',
  [ORDER_STATUS.CANCELLED]: 'Cancelled',
};

const PAYMENT_LABELS = {
  cash: 'Cash',
  gcash: 'GCash',
  card: 'Card',
  cash_on_pickup: 'Cash on Pickup',
};

const INK = '#0f172a';
const MUTED = '#5b6474';
const RULE = '#e5e8f0';

/**
 * A4 is 842pt tall and the 50pt margin puts the content floor at 792.
 * The footer starts at 742 and the verification block needs ~110pt above
 * it — drawing past these makes pdfkit spill onto an extra, near-empty page.
 */
const FOOTER_Y = 742;
const VERIFY_MIN_HEIGHT = 110;

const money = (value) =>
  `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateTime = (value) =>
  new Date(value).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Shared masthead: shop identity left, document identity right.
 *
 * Takes a title and reference rather than an order, because the same block
 * heads the sales invoice, the receipt and the purchase order — three
 * documents that should look like they come from the same shop.
 */
function drawHeader(doc, settings, { title, reference, date }) {
  const top = 46;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 50, top, { fit: [46, 46] });
  }

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(settings.shopName || 'Flavor & Color', 106, top + 2);

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(settings.addressLine || '', 106, top + 22, { width: 220 });
  if (settings.phone) doc.text(settings.phone, 106, top + 34, { width: 220 });

  // Document title block, right aligned.
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(INK)
    .text(title, 340, top, { width: 205, align: 'right', characterSpacing: 1 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(reference, 340, top + 24, { width: 205, align: 'right' })
    .text(dateTime(date), 340, top + 38, { width: 205, align: 'right' });

  doc.moveTo(50, top + 62).lineTo(545, top + 62).lineWidth(1.5).strokeColor(INK).stroke();
}

function drawMeta(doc, order, transaction) {
  const top = 128;

  const label = (text, x) =>
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(text.toUpperCase(), x, top, {
      characterSpacing: 0.6,
    });

  label('Billed To', 50);
  label('Order Details', 320);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(INK)
    .text(order.customerName || 'Walk-in Customer', 50, top + 14, { width: 250 });

  const paid = transaction
    ? `${PAYMENT_LABELS[transaction.method] || transaction.method} - paid ${dateTime(transaction.createdAt)}`
    : order.payment?.method
      ? `${PAYMENT_LABELS[order.payment.method]} - not yet paid`
      : 'Not yet selected';

  doc
    .fillColor(INK)
    .text(`Status: ${STATUS_LABELS[order.status] || order.status}`, 320, top + 14, { width: 225 })
    .text(`Payment: ${paid}`, 320, top + 28, { width: 225 });
}

/**
 * Items table, shared by all three documents.
 *
 * Lines arrive already flattened to { name, sku, price, quantity, lineTotal }
 * so a purchase order's cost columns and a sale's price columns render
 * identically — the difference between them is wording, not layout.
 *
 * Returns the y position just under the totals.
 */
function drawItems(doc, { items, subtotal, total }, labels = {}) {
  const columns = { item: 50, price: 330, qty: 415, amount: 465 };
  let y = 190;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text('ITEM', columns.item, y, { characterSpacing: 0.6 });
  doc.text(labels.unit || 'UNIT PRICE', columns.price, y, { width: 75, align: 'right' });
  doc.text('QTY', columns.qty, y, { width: 35, align: 'right' });
  doc.text('AMOUNT', columns.amount, y, { width: 80, align: 'right' });

  y += 14;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).strokeColor(INK).stroke();
  y += 10;

  for (const item of items) {
    // Start a new page before a row would run off the bottom.
    if (y > 690) {
      doc.addPage();
      y = 60;
    }

    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(item.name, columns.item, y, { width: 260 });
    doc.text(money(item.price), columns.price, y, { width: 75, align: 'right' });
    doc.text(String(item.quantity), columns.qty, y, { width: 35, align: 'right' });
    doc.text(money(item.lineTotal), columns.amount, y, { width: 80, align: 'right' });

    if (item.sku) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(item.sku, columns.item, y + 12);
      y += 12;
    }

    y += 18;
    doc.moveTo(50, y - 5).lineTo(545, y - 5).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  y += 6;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  doc.text('Subtotal', columns.price - 60, y, { width: 135, align: 'right' });
  doc.fillColor(INK).text(money(subtotal), columns.amount, y, { width: 80, align: 'right' });

  y += 20;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  doc.text(labels.total || 'Total Due', columns.price - 60, y, { width: 135, align: 'right' });
  doc.text(money(total), columns.amount, y, { width: 80, align: 'right' });

  return y + 28;
}

/** Order and PO lines share a shape once the naming differences are dropped. */
const orderLines = (order) =>
  order.items.map((item) => ({
    name: item.name,
    sku: item.sku,
    price: item.price,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  }));

const poLines = (po) =>
  po.items.map((item) => ({
    name: item.name,
    sku: item.sku,
    price: item.unitCost,
    // Once received, the document should say what arrived, not what was hoped
    // for — a short delivery is the whole reason to keep both numbers.
    quantity:
      item.quantityReceived === null
        ? item.quantityOrdered
        : `${item.quantityReceived}/${item.quantityOrdered}`,
    lineTotal: item.lineTotal,
  }));

async function drawVerification(doc, order, y, appUrl) {
  const code = documentCode(order);
  const verifyUrl = `${appUrl}/verify?order=${encodeURIComponent(order.orderNumber)}&code=${code}`;

  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(RULE).stroke();
  const top = y + 12;

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(MUTED)
    .text('DOCUMENT VERIFICATION', 50, top, { characterSpacing: 0.6 });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      'Check this document against our records — any altered figure will fail the check.',
      50,
      top + 14,
      { width: 380 }
    );

  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(code, 50, top + 40);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(verifyUrl, 50, top + 56, { width: 380 });

  try {
    const qr = await QRCode.toBuffer(verifyUrl, { margin: 0, width: 160 });
    doc.image(qr, 465, top + 6, { fit: [72, 72] });
  } catch {
    // A missing QR is cosmetic; the code and URL above still verify.
  }
}

/**
 * Sits above the bottom margin (A4 is 842pt tall, content ends at 792).
 * Overshooting here makes pdfkit spill onto a second, near-empty page.
 */
function drawFooter(doc, order, settings) {
  const y = FOOTER_Y;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(RULE).stroke();

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `Thank you for choosing ${settings.shopName || 'Flavor & Color'}! ` +
        'Keep this sales invoice for pickup and warranty purposes.',
      50,
      y + 8,
      { width: 495, lineBreak: false }
    );

  if (order.status === ORDER_STATUS.PENDING_PAYMENT && settings.gcashNumber) {
    doc.text(
      `To pay by GCash: send ${money(order.total)} to ${settings.gcashNumber} ` +
        `(${settings.gcashName}) using ${order.orderNumber} as the reference.`,
      50,
      y + 20,
      { width: 495, lineBreak: false }
    );
  }
}

/**
 * Renders the sales invoice and resolves with the finished PDF as a Buffer, so
 * the caller decides whether to stream it, attach it or store it.
 */
async function renderInvoice(order, transaction, { appUrl } = {}) {
  const settings = await Setting.get();
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: `Sales Invoice ${order.orderNumber}`,
    Author: settings.shopName || 'Flavor & Color',
    Subject: `Sales Invoice for order ${order.orderNumber}`,
  } });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawHeader(doc, settings, {
    title: 'SALES INVOICE',
    reference: order.orderNumber,
    date: order.createdAt,
  });
  drawMeta(doc, order, transaction);
  const afterItems = drawItems(doc, {
    items: orderLines(order),
    subtotal: order.subtotal,
    total: order.total,
  });

  let y = afterItems;
  if (order.notes) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Customer notes: ${order.notes}`, 50, y, { width: 495 });
    y = doc.y + 12;
  }

  // A long order can push the items table close to the floor; give the
  // verification block and footer a fresh page rather than letting them
  // collide or overflow.
  if (y > FOOTER_Y - VERIFY_MIN_HEIGHT) {
    doc.addPage();
    y = 60;
  }

  await drawVerification(doc, order, Math.max(y, FOOTER_Y - VERIFY_MIN_HEIGHT), appUrl || '');
  drawFooter(doc, order, settings);

  doc.end();
  return finished;
}

/** Wraps the pdfkit stream-to-buffer dance every renderer here needs. */
function toBuffer(doc) {
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * The sales receipt.
 *
 * Distinct from the sales invoice: an invoice states what is owed, a receipt
 * records what was paid. So this one leads with the payment — method, amount
 * tendered, change — and carries the receipt number rather than the order
 * number as its identity.
 *
 * Rendered on demand from the transaction, never stored. The transaction is
 * immutable once written, so the same input always produces the same
 * document, which is what makes the admin's copy and the cashier's copy the
 * same receipt rather than two of them.
 */
async function renderReceipt(order, transaction, { appUrl } = {}) {
  const settings = await Setting.get();
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Receipt ${transaction.receiptNumber}`,
      Author: settings.shopName || 'Flavor & Color',
      Subject: `Official receipt for order ${order.orderNumber}`,
      /**
       * Pinned to when the payment happened, not to when this render ran.
       * A receipt is dated by its sale, and pinning it also makes the file
       * reproducible: the cashier's download and the admin's are the same
       * bytes, so there is provably one receipt rather than two that merely
       * look alike.
       */
      CreationDate: new Date(transaction.createdAt),
      ModDate: new Date(transaction.createdAt),
    },
  });
  const finished = toBuffer(doc);

  drawHeader(doc, settings, {
    title: 'OFFICIAL RECEIPT',
    reference: transaction.receiptNumber,
    date: transaction.createdAt,
  });

  // Who paid, and who took the payment — the two people this document is
  // evidence for.
  const top = 128;
  const label = (text, x) =>
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(text.toUpperCase(), x, top, {
      characterSpacing: 0.6,
    });

  label('Received From', 50);
  label('Transaction', 320);

  const cashier = transaction.receivedBy;
  const cashierName =
    cashier && cashier.firstName ? `${cashier.firstName} ${cashier.lastName}`.trim() : 'Staff';

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(INK)
    .text(order.customerName || 'Walk-in Customer', 50, top + 14, { width: 250 })
    .text(`Order ${order.orderNumber}`, 320, top + 14, { width: 225 })
    .text(`Processed by ${cashierName}`, 320, top + 28, { width: 225 });

  const afterItems = drawItems(
    doc,
    { items: orderLines(order), subtotal: order.subtotal, total: order.total },
    { total: 'Total Paid' }
  );

  // The payment block: what a receipt exists to record.
  let y = afterItems;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(RULE).stroke();
  y += 12;

  const row = (name, value, bold = false) => {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10)
      .fillColor(bold ? INK : MUTED)
      .text(name, 270, y, { width: 135, align: 'right' });
    doc.fillColor(INK).text(value, 465, y, { width: 80, align: 'right' });
    y += 18;
  };

  row('Payment Method', PAYMENT_LABELS[transaction.method] || transaction.method);
  row('Amount Tendered', money(transaction.amountTendered));
  row('Change', money(transaction.change));
  row('Amount Paid', money(transaction.amount), true);

  if (y > FOOTER_Y - VERIFY_MIN_HEIGHT) {
    doc.addPage();
    y = 60;
  }
  await drawVerification(doc, order, Math.max(y + 8, FOOTER_Y - VERIFY_MIN_HEIGHT), appUrl || '');
  drawFooter(doc, order, settings);

  doc.end();
  return finished;
}

/**
 * The purchase order sent to a supplier.
 *
 * Outbound rather than inbound: the shop is the buyer here, so the parties
 * are reversed — supplier details lead, and the total is what the shop owes
 * rather than what it is owed. No verification code: that block exists so a
 * customer's document can be checked against the shop's records, and the
 * shop does not need to prove this one to itself.
 */
async function renderPurchaseOrder(po, settings) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Purchase Order ${po.poNumber}`,
      Author: settings.shopName || 'Flavor & Color',
      Subject: `Purchase order to ${po.supplierName}`,
    },
  });
  const finished = toBuffer(doc);

  drawHeader(doc, settings, {
    title: 'PURCHASE ORDER',
    reference: po.poNumber,
    date: po.createdAt,
  });

  const top = 128;
  const label = (text, x) =>
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(text.toUpperCase(), x, top, {
      characterSpacing: 0.6,
    });

  label('Supplier', 50);
  label('Order Details', 320);

  const supplier = po.supplier && po.supplier.name ? po.supplier : { name: po.supplierName };
  const supplierLines = [
    supplier.name,
    supplier.contactPerson,
    supplier.phone,
    supplier.email,
    supplier.address,
  ].filter(Boolean);

  doc.font('Helvetica').fontSize(10).fillColor(INK);
  supplierLines.forEach((line, index) => {
    doc.text(line, 50, top + 14 + index * 13, { width: 250 });
  });

  const details = [
    `Status: ${PO_STATUS_LABELS[po.status] || po.status}`,
    po.expectedDate ? `Expected: ${dateTime(po.expectedDate)}` : null,
    supplier.paymentTerms ? `Terms: ${supplier.paymentTerms}` : null,
    po.receivedAt ? `Received: ${dateTime(po.receivedAt)}` : null,
  ].filter(Boolean);

  details.forEach((line, index) => {
    doc.text(line, 320, top + 14 + index * 13, { width: 225 });
  });

  let y = drawItems(
    doc,
    { items: poLines(po), subtotal: po.subtotal, total: po.total },
    { unit: 'UNIT COST', total: 'Order Total' }
  );

  if (po.notes) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`Notes: ${po.notes}`, 50, y, { width: 495 });
    y = doc.y + 12;
  }

  // Signature lines: a purchase order is an instruction someone authorises
  // and someone else acknowledges on delivery.
  if (y > FOOTER_Y - 90) {
    doc.addPage();
    y = 60;
  }
  const signatureY = Math.max(y + 30, FOOTER_Y - 90);
  const signature = (caption, x) => {
    doc.moveTo(x, signatureY).lineTo(x + 200, signatureY).lineWidth(0.5).strokeColor(INK).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(caption, x, signatureY + 6, {
      width: 200,
    });
  };
  signature('Authorised by', 50);
  signature('Received by', 320);

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `${settings.shopName || 'Flavor & Color'} - purchase order ${po.poNumber}`,
      50,
      FOOTER_Y + 10,
      { width: 495, align: 'center' }
    );

  doc.end();
  return finished;
}

module.exports = { renderInvoice, renderReceipt, renderPurchaseOrder };
