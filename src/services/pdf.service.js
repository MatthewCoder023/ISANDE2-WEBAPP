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
 * Currency prints as "Php" rather than ₱: pdfkit's built-in fonts use
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
  `Php ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const moneySpecial = (value) =>
  `${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


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
function drawRightAlignedValue(doc, text, x, y, width, fontName = 'Helvetica', fontSize = 10) {
  const measuredWidth = doc.widthOfString(text, { lineBreak: false }) + 8;
  const resolvedWidth = Math.max(width, Math.ceil(measuredWidth));

  doc.font(fontName).fontSize(fontSize).text(text, x, y, {
    width: resolvedWidth,
    align: 'right',
    lineBreak: false,
    ellipsis: false,
  });

  return resolvedWidth;
}

function drawItems(doc, { items, subtotal, total }, labels = {}, startY = 190) {
  const itemX = 50;
  const rightEdge = 545;
  const gap = 16;
  const basePriceWidth = 75;
  const baseQtyWidth = 35;
  const baseAmountWidth = 80;

  let y = startY;

  const priceHeader = labels.unit || 'UNIT PRICE';
  const priceTexts = items.map((item) => money(item.price));
  const qtyTexts = items.map((item) => String(item.quantity));
  const amountTexts = items.map((item) => money(item.lineTotal));
  amountTexts.push(money(subtotal), money(total));
  const totalLabels = ['Subtotal', labels.total || 'Total Due'];

  const priceWidth = Math.max(
    basePriceWidth,
    Math.ceil(doc.widthOfString(priceHeader, { lineBreak: false })) + 8,
    ...priceTexts.map((text) => Math.ceil(doc.widthOfString(text, { lineBreak: false })) + 8),
    ...totalLabels.map((text) => Math.ceil(doc.widthOfString(text, { lineBreak: false })) + 8)
  );
  const qtyWidth = Math.max(
    baseQtyWidth,
    Math.ceil(doc.widthOfString('QTY', { lineBreak: false })) + 8,
    ...qtyTexts.map((text) => Math.ceil(doc.widthOfString(text, { lineBreak: false })) + 8)
  );
  const amountWidth = Math.max(
    baseAmountWidth,
    Math.ceil(doc.widthOfString('AMOUNT', { lineBreak: false })) + 8,
    ...amountTexts.map((text) => Math.ceil(doc.widthOfString(text, { lineBreak: false })) + 8)
  );

  const amountX = rightEdge - amountWidth;
  const qtyX = amountX - gap - qtyWidth;
  const priceX = qtyX - gap - priceWidth;
  const itemWidth = priceX - 20 - itemX;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  doc.text('ITEM', itemX, y, { characterSpacing: 0.6 });
  doc.text(priceHeader, priceX, y, { width: priceWidth, align: 'right', lineBreak: false, ellipsis: false });
  doc.text('QTY', qtyX, y, { width: qtyWidth, align: 'right', lineBreak: false, ellipsis: false });
  doc.text('AMOUNT', amountX, y, { width: amountWidth, align: 'right', lineBreak: false, ellipsis: false });

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
    doc.text(item.name, itemX, y, { width: itemWidth });
    drawRightAlignedValue(doc, money(item.price), priceX, y, priceWidth);
    drawRightAlignedValue(doc, String(item.quantity), qtyX, y, qtyWidth);
    drawRightAlignedValue(doc, money(item.lineTotal), amountX, y, amountWidth);

    if (item.sku) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(item.sku, itemX, y + 12);
      y += 12;
    }

    y += 18;
    doc.moveTo(50, y - 5).lineTo(545, y - 5).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  y += 6;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  drawRightAlignedValue(doc, 'Subtotal', priceX, y, priceWidth);
  doc.fillColor(INK).text(money(subtotal), amountX, y, {
    width: amountWidth,
    align: 'right',
    lineBreak: false,
    ellipsis: false,
  });

  y += 20;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(INK);
  drawRightAlignedValue(doc, labels.total || 'Total Due', priceX, y, priceWidth, 'Helvetica-Bold', 12);
  doc.text(money(total), amountX, y, {
    width: amountWidth,
    align: 'right',
    lineBreak: false,
    ellipsis: false,
  });

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

  doc.initForm();

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

  const metaLines = Math.max(supplierLines.length, details.length);
  const tableStartY = Math.max(190, top + 14 + metaLines * 13 + 18);
  let y = drawItems(
    doc,
    { items: poLines(po), subtotal: po.subtotal, total: po.total },
    { unit: 'UNIT COST', total: 'Order Total' },
    tableStartY
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
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(caption, x, signatureY - 14, {
      width: 200,
    });

    const signatureFieldY = signatureY + 8;
    const nameFieldY = signatureFieldY + 46;
    const fieldName = caption.toLowerCase().replace(/[^a-z0-9]+/g, '');

    doc.moveTo(x, signatureFieldY + 36).lineTo(x + 200, signatureFieldY + 36).lineWidth(0.5).strokeColor(INK).stroke();

    doc.formText(`${fieldName}Signature`, x, signatureFieldY, 200, 36, {
      border: true,
      multiline: true,
      font: 'Helvetica',
      fontSize: 10,
    });
    doc.formText(`${fieldName}Name`, x, nameFieldY, 200, 22, {
      border: true,
      multiline: false,
      font: 'Helvetica',
      fontSize: 10,
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

// All reports are now exported as PDFs. This renders the report's sections as tables, with a title and optional metadata above them.
function drawReportTableSection(doc, section, y) {
  const left = 50;
  const rightEdge = 545;
  const gap = 10;
  const headerHeight = 14;
  const rowHeight = 18;
  const columns = section.columns || [];
  const rows = section.rows || [];
  const widths = columns.map((column) => column.width || 100);
  const availableWidth = rightEdge - left;
  const totalDefinedWidth = widths.reduce((sum, width) => sum + width, 0);
  const columnGaps = gap * Math.max(columns.length - 1, 0);
  let resolvedWidths;

  if (totalDefinedWidth + columnGaps > availableWidth) {
    const scale = Math.max(0.2, (availableWidth - columnGaps) / totalDefinedWidth);
    resolvedWidths = widths.map((width) => Math.max(20, Math.floor(width * scale)));
    const currentTotal = resolvedWidths.reduce((sum, width) => sum + width, 0);
    const adjust = availableWidth - columnGaps - currentTotal;
    if (adjust !== 0 && resolvedWidths.length > 0) {
      resolvedWidths[resolvedWidths.length - 1] += adjust;
    }
  } else {
    const remainingWidth = availableWidth - totalDefinedWidth - columnGaps;
    resolvedWidths = widths.map((width, index) => (index === widths.length - 1 ? width + remainingWidth : width));
  }

  const xPositions = [];
  let x = left;
  resolvedWidths.forEach((width) => {
    xPositions.push(x);
    x += width + gap;
  });

  const formatCellValue = (value, column = {}) => {
    if (column.type === 'currency') {
      return money(value);
    }
    if (column.type === 'currencySpecial') {
      return moneySpecial(value);
    }
    if (column.type === 'number') {
      const numericValue = Number(value || 0);
      return Number.isFinite(numericValue) ? numericValue.toLocaleString('en-PH') : String(value ?? '');
    }
    return String(value ?? '');
  };

  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
  const headerHeights = columns.map((column, index) =>
    doc.heightOfString(String(column.label ?? ''), {
      width: resolvedWidths[index],
      align: column.align === 'right' ? 'right' : 'left',
      lineBreak: true,
    })
  );
  const renderedHeaderHeight = Math.max(headerHeight, Math.max(...headerHeights) + 4);

  if (y + renderedHeaderHeight > FOOTER_Y - 60) {
    doc.addPage();
    y = 60;
  }

  columns.forEach((column, index) => {
    const columnHeaderHeight = headerHeights[index];
    const textY = y + renderedHeaderHeight - columnHeaderHeight - 2;
    doc.text(column.label, xPositions[index], textY, {
      width: resolvedWidths[index],
      align: column.align === 'right' ? 'right' : 'left',
      lineBreak: true,
      ellipsis: false,
    });
  });

  y += renderedHeaderHeight;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(1).strokeColor(INK).stroke();
  y += 10;

  for (const row of rows) {
    const cellHeights = row.map((value, index) => {
      const column = columns[index] || {};
      return doc.heightOfString(formatCellValue(value, column), {
        width: resolvedWidths[index],
        align: column.align === 'right' ? 'right' : 'left',
        lineBreak: true,
      });
    });
    const thisRowHeight = Math.max(rowHeight, Math.max(...cellHeights) + 4);

    if (y + thisRowHeight > FOOTER_Y - 60) {
      doc.addPage();
      y = 60;
    }

    doc.font('Helvetica').fontSize(9).fillColor(INK);
    row.forEach((value, index) => {
      const column = columns[index] || {};
      doc.text(formatCellValue(value, column), xPositions[index], y + 2, {
        width: resolvedWidths[index],
        align: column.align === 'right' ? 'right' : 'left',
        lineBreak: true,
        ellipsis: false,
      });
    });

    y += thisRowHeight;
    doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 2;
  }

  return y + 12;
}

// All reports are now exported as PDFs. This renderer takes a title, scope, metadata and sections to render.
async function renderReportPdf({ title, scope, metadata = [], sections = [], settings, fileName }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: title,
      Author: settings.shopName || 'Flavor & Color',
      Subject: scope,
    },
  });
  const finished = toBuffer(doc);

  drawHeader(doc, settings, {
    title: title.toUpperCase(),
    reference: fileName || scope,
    date: new Date(),
  });

  let y = 128;
  if (scope || metadata.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('Report Details', 50, y, { characterSpacing: 0.6 });
    y += 14;

    if (scope) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Scope', 50, y, { width: 140 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(String(scope), 200, y, { width: 300 });
      y += 14;
    }

    metadata.forEach((row) => {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(row.label, 50, y, { width: 140 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(String(row.value), 200, y, { width: 300 });
      y += 14;
    });
    y += 6;
  }

  for (const section of sections) {
    if (section.pageBreakBefore) {
      doc.addPage();
      y = 60;
    } else if (y > FOOTER_Y - 120) {
      doc.addPage();
      y = 60;
    }

    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(section.title, 50, y, { width: 495 });
    y += 16;
    doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 10;

    if (section.type === 'table') {
      y = drawReportTableSection(doc, section, y);
      y += 12;
      continue;
    }

    for (const row of section.rows || []) {
      if (y > FOOTER_Y - 60) {
        doc.addPage();
        y = 60;
      }

      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(row.label, 50, y, { width: 180 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(String(row.value), 240, y, { width: 260 });
      y += 14;
    }

    y += 16;
  }

  const capitalize = str => str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text(
      `${settings.shopName || 'Flavor & Color'} - ${capitalize(title)}`,
      50,
      FOOTER_Y + 10,
      { width: 495, align: 'center' }
    );

  doc.end();
  return finished;
}

module.exports = { renderInvoice, renderReceipt, renderPurchaseOrder, renderReportPdf };
