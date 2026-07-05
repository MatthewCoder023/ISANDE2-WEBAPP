/** Order tracker: timeline of the order's journey through the shop. */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { STATUS_BADGES, PAYMENT_LABELS, buildTimeline } from '/js/orders-ui.js';

const orderId = new URLSearchParams(window.location.search).get('order');

const STATE_CLASSES = {
  done: 'is-done',
  current: 'is-current',
  upcoming: 'is-upcoming',
  cancelled: 'is-cancelled',
};

function renderTimeline(order) {
  const steps = buildTimeline(order);
  document.querySelector('#timeline').innerHTML = steps
    .map(
      (step) => `
      <li class="timeline-step ${STATE_CLASSES[step.state] || ''}">
        <span class="timeline-dot">${step.state === 'done' || step.state === 'cancelled' ? '✓' : ''}</span>
        <div class="timeline-label">${escapeHtml(step.label)}</div>
        <div class="timeline-desc">${escapeHtml(step.description)}</div>
        ${step.at ? `<div class="timeline-time">${formatDateTime(step.at)}</div>` : ''}
      </li>`
    )
    .join('');
}

function renderSummary(order, transaction) {
  document.querySelector('#track-number').textContent = order.orderNumber;
  document.querySelector('#track-status').innerHTML = STATUS_BADGES[order.status] || '';
  document.querySelector('#track-subtitle').textContent =
    `Placed ${formatDateTime(order.createdAt)}`;
  document.querySelector('#track-invoice-link').href = `/invoice?order=${order.id}`;

  if (order.status === 'pending_payment') {
    const payLink = document.querySelector('#track-pay-link');
    payLink.href = `/client/payment?order=${order.id}`;
    payLink.hidden = false;
  }

  const paymentLine = transaction
    ? `${PAYMENT_LABELS[transaction.method]} · paid ${formatDateTime(transaction.createdAt)}`
    : order.payment?.method
      ? `${PAYMENT_LABELS[order.payment.method]} · not yet paid`
      : 'Not yet selected';

  const itemLines = order.items
    .map(
      (item) => `
      <div style="display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.875rem; padding: 0.375rem 0;">
        <span>${escapeHtml(item.name)} × ${item.quantity}</span>
        <span>${formatPrice(item.lineTotal)}</span>
      </div>`
    )
    .join('');

  document.querySelector('#track-summary').innerHTML = `
    ${itemLines}
    <div style="display: flex; justify-content: space-between; font-weight: 800; border-top: 2px solid var(--border); padding-top: 0.625rem; margin-top: 0.375rem;">
      <span>Total</span><span>${formatPrice(order.total)}</span>
    </div>
    <p class="text-muted" style="font-size: 0.875rem; margin-top: 0.875rem;">
      <strong>Payment:</strong> ${paymentLine}
    </p>
    ${order.notes ? `<p class="text-muted" style="font-size: 0.875rem; margin-top: 0.375rem;"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ''}`;
}

async function loadOrder() {
  if (!orderId) {
    window.location.assign('/client/orders');
    return;
  }
  try {
    const { data } = await api(`/api/orders/${orderId}`);
    renderTimeline(data.order);
    renderSummary(data.order, data.transaction);
  } catch (error) {
    showToast(error.message, 'error');
    document.querySelector('#track-subtitle').textContent = 'Could not load this order.';
  }
}

loadOrder();
