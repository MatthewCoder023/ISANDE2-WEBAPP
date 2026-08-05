/**
 * The single screen for one order: where it is, what's in it, its invoice,
 * and — while it still needs paying — the payment step itself. Placing an
 * order lands here, so there is one place that answers "what happens now?".
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { setBusy } from '/js/form-utils.js';
import { STATUS_BADGES, PAYMENT_LABELS, buildTimeline } from '/js/orders-ui.js';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const orderId = new URLSearchParams(window.location.search).get('order');
let selectedFile = null;

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

/* ---------- Payment (only while the order is unpaid) ---------- */

const paymentCard = document.querySelector('#payment-card');
const submitProofButton = document.querySelector('#submit-proof-btn');

function renderPayment(order) {
  // Anything past pending_payment is either paid or being handled in store.
  if (order.status !== 'pending_payment') {
    paymentCard.hidden = true;
    return;
  }

  paymentCard.hidden = false;
  const amount = formatPrice(order.total);
  document.querySelector('#pay-total').textContent = amount;
  document.querySelector('#gcash-amount').textContent = amount;
  document.querySelector('#gcash-reference').textContent = order.orderNumber;

  if (order.payment?.rejectedReason) {
    document.querySelector('#rejected-alert').hidden = false;
    document.querySelector('#rejected-reason').textContent = order.payment.rejectedReason;
  }
}

async function loadGcashDetails() {
  try {
    const { data } = await api('/api/settings');
    document.querySelector('#gcash-number').textContent = data.settings.gcashNumber;
    document.querySelector('#gcash-name').textContent = data.settings.gcashName;
  } catch {
    // The defaults already in the markup remain.
  }
}

function selectFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('Proof must be a JPG, PNG, or WebP image.', 'warning');
    return;
  }
  if (file.size > MAX_SIZE_BYTES) {
    showToast('That file is over 5 MB — please upload a smaller image.', 'warning');
    return;
  }

  selectedFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    document.querySelector('#proof-img').src = reader.result;
    document.querySelector('#proof-preview').hidden = false;
    document.querySelector('#proof-filename').textContent = file.name;
    submitProofButton.disabled = false;
  };
  reader.readAsDataURL(file);
}

function wireUploadZone() {
  const uploadZone = document.querySelector('#upload-zone');
  const proofInput = document.querySelector('#proof-input');

  uploadZone.addEventListener('click', () => proofInput.click());
  uploadZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      proofInput.click();
    }
  });
  uploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadZone.classList.add('is-dragover');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragover'));
  uploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadZone.classList.remove('is-dragover');
    const file = event.dataTransfer.files?.[0];
    if (file) selectFile(file);
  });
  proofInput.addEventListener('change', () => {
    const file = proofInput.files?.[0];
    if (file) selectFile(file);
  });

  submitProofButton.addEventListener('click', async () => {
    if (!selectedFile) return;
    setBusy(submitProofButton, true, 'Uploading…');

    const body = new FormData();
    body.append('proof', selectedFile);

    try {
      const { message, data } = await api(`/api/orders/${orderId}/proof`, { method: 'POST', body });
      showToast(message, 'success');
      // The timeline moves on and the payment step retires itself.
      renderTimeline(data.order);
      renderSummary(data.order, null);
      renderPayment(data.order);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setBusy(submitProofButton, false);
    }
  });

  document.querySelector('#switch-cash-btn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { message, data } = await api(`/api/orders/${orderId}/payment-method`, {
        method: 'POST',
        body: { method: 'cash_on_pickup' },
      });
      showToast(message, 'success');
      renderTimeline(data.order);
      renderSummary(data.order, null);
      renderPayment(data.order);
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });
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
    renderPayment(data.order);
    if (data.order.status === 'pending_payment') loadGcashDetails();
  } catch (error) {
    showToast(error.message, 'error');
    document.querySelector('#track-subtitle').textContent = 'Could not load this order.';
  }
}

wireUploadZone();
loadOrder();
