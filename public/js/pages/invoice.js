/**
 * Printable invoice. Loads the order (owner or staff), renders a clean
 * document, and offers the browser's print dialog — which is also how
 * customers save it as a PDF.
 */
import { api } from '/js/api.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';

const STATUS_LABELS = {
  pending_payment: 'Pending Payment',
  pending_verification: 'Pending Verification',
  payment_verified: 'Payment Verified',
  preparing: 'Preparing Order',
  ready: 'Ready for Pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const orderId = new URLSearchParams(window.location.search).get('order');

document.querySelector('#back-btn').addEventListener('click', () => history.back());
document.querySelector('#print-btn').addEventListener('click', () => window.print());

async function loadInvoice() {
  try {
    const [orderRes, settingsRes] = await Promise.all([
      api(`/api/orders/${orderId}`),
      api('/api/settings').catch(() => null),
    ]);
    render(orderRes.data.order, orderRes.data.transaction, settingsRes?.data.settings || null);
  } catch {
    document.querySelector('#invoice-error').hidden = false;
  }
}

function render(order, transaction, settings) {
  document.querySelector('#inv-number').textContent = order.orderNumber;
  document.querySelector('#inv-date').textContent = formatDateTime(order.createdAt);
  document.querySelector('#inv-customer').textContent = order.customerName || 'Walk-in Customer';
  document.querySelector('#inv-status').textContent = STATUS_LABELS[order.status] || order.status;

  let paymentText;
  if (transaction) {
    paymentText = `${PAYMENT_LABELS[transaction.method] || transaction.method} — paid ${formatDateTime(transaction.createdAt)}`;
  } else if (order.payment?.method) {
    paymentText = `${PAYMENT_LABELS[order.payment.method]} — not yet paid`;
  } else {
    paymentText = 'Not yet selected';
  }
  document.querySelector('#inv-payment').textContent = paymentText;

  document.querySelector('#inv-items').innerHTML = order.items
    .map(
      (item) => `
      <tr>
        <td>
          ${escapeHtml(item.name)}
          <div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(item.sku)}</div>
        </td>
        <td class="num">${formatPrice(item.price)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatPrice(item.lineTotal)}</td>
      </tr>`
    )
    .join('');

  document.querySelector('#inv-subtotal').textContent = formatPrice(order.subtotal);
  document.querySelector('#inv-total').textContent = formatPrice(order.total);

  if (order.notes) {
    const notes = document.querySelector('#inv-notes');
    notes.textContent = `Customer notes: ${order.notes}`;
    notes.hidden = false;
  }

  if (order.status === 'pending_payment') {
    const gcashNumber = settings?.gcashNumber || '0917 555 0123';
    const gcashName = settings?.gcashName || 'Vernici Artisan Corp.';
    const instructions = document.querySelector('#inv-instructions');
    instructions.innerHTML =
      `<strong>Payment instructions:</strong> pay via GCash to ${escapeHtml(gcashNumber)} ` +
      `(${escapeHtml(gcashName)}) with reference <strong>${escapeHtml(order.orderNumber)}</strong> ` +
      'and upload your proof on the payment page, or choose cash on pickup.';
    instructions.hidden = false;
  }

  document.querySelector('#inv-generated').textContent =
    `Generated ${formatDateTime(new Date().toISOString())}`;
  document.querySelector('#invoice-sheet').hidden = false;
}

if (orderId) loadInvoice();
else document.querySelector('#invoice-error').hidden = false;
