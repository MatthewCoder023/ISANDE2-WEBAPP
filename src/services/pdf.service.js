const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const Setting = require('../models/Setting');
const { documentCode } = require('./document.service');
const { ORDER_STATUS } = require('../constants/orders');

/**
 * Server-rendered invoice PDF.
 *
 * The on-screen invoice stays the browser-print path; this produces the
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

/** Brand rule across the head of the page, mirroring the on-screen sheet. */
function drawAccentBar(doc) {
  const { width } = doc.page;
  const gradient = doc.linearGradient(0, 0, width, 0);
  gradient.stop(0, '#4f46e5').stop(0.5, '#7c3aed').stop(1, '#f59e0b');
  doc.rect(0, 0, width, 6).fill(gradient);
}

function drawHeader(doc, settings, order) {
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
    .text('INVOICE', 340, top, { width: 205, align: 'right', characterSpacing: 1 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(order.orderNumber, 340, top + 24, { width: 205, align: 'right' })
    .text(dateTime(order.createdAt), 340, top + 38, { width: 205, align: 'right' });

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

/** Items table. Returns the y position just under the totals. */
function drawItems(doc, order) {
  const columns = { item: 50, price: 330, qty: 415, amount: 465 };
  let y = 190;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text('ITEM', columns.item, y, { characterSpacing: 0.6 });
  doc.text('UNIT PRICE', columns.price, y, { width: 75, align: 'right' });
  doc.text('QTY', columns.qty, y, { width: 35, align: 'right' });
  doc.text('AMOUNT', columns.amount, y, { width: 80, align: 'right' });

  y += 14;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).strokeColor(INK).stroke();
  y += 10;

  for (const item of order.items) {
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
  doc.fillColor(INK).text(money(order.subtotal), columns.amount, y, { width: 80, align: 'right' });

  y += 20;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  doc.text('Total Due', columns.price - 60, y, { width: 135, align: 'right' });
  doc.text(money(order.total), columns.amount, y, { width: 80, align: 'right' });

  return y + 28;
}

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
        'Keep this invoice for pickup and warranty purposes.',
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
 * Renders the invoice and resolves with the finished PDF as a Buffer, so
 * the caller decides whether to stream it, attach it or store it.
 */
async function renderInvoice(order, transaction, { appUrl } = {}) {
  const settings = await Setting.get();
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: `Invoice ${order.orderNumber}`,
    Author: settings.shopName || 'Flavor & Color',
    Subject: `Invoice for order ${order.orderNumber}`,
  } });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawAccentBar(doc);
  drawHeader(doc, settings, order);
  drawMeta(doc, order, transaction);
  const afterItems = drawItems(doc, order);

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

module.exports = { renderInvoice };
