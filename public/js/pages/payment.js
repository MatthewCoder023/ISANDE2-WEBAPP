/**
 * Checkout step 2: choose a payment method for a pending order.
 * GCash -> pay by transfer, upload proof, await verification.
 * Cash on pickup -> confirm and the shop starts preparing.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { formatPrice } from '/js/format.js';
import { setBusy } from '/js/form-utils.js';

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const orderId = new URLSearchParams(window.location.search).get('order');
let selectedFile = null;

const loadingEl = document.querySelector('#payment-loading');
const paymentPanel = document.querySelector('#payment-panel');
const statusPanel = document.querySelector('#status-panel');
const submitProofButton = document.querySelector('#submit-proof-btn');

function showStatusPanel(title, message, order) {
  loadingEl.hidden = true;
  paymentPanel.hidden = true;
  statusPanel.hidden = false;
  document.querySelector('#status-title').textContent = title;
  document.querySelector('#status-message').textContent = message;
  document.querySelector('#status-track-link').href = `/client/track?order=${order.id}`;
  document.querySelector('#status-invoice-link').href = `/invoice?order=${order.id}`;
}

function showPaymentPanel(order) {
  loadingEl.hidden = true;
  paymentPanel.hidden = false;

  document.querySelector('#pay-order-number').textContent = order.orderNumber;
  document.querySelector('#pay-total').textContent = formatPrice(order.total);
  document.querySelector('#pay-invoice-link').href = `/invoice?order=${order.id}`;
  document.querySelector('#gcash-amount').textContent = formatPrice(order.total);
  document.querySelector('#gcash-reference').textContent = order.orderNumber;
  document.querySelector('#cash-amount').textContent = formatPrice(order.total);
  document.querySelector('#cash-reference').textContent = order.orderNumber;

  if (order.payment?.rejectedReason) {
    document.querySelector('#rejected-alert').hidden = false;
    document.querySelector('#rejected-reason').textContent = order.payment.rejectedReason;
  }
}

async function loadOrder() {
  if (!orderId) {
    window.location.assign('/client/orders');
    return;
  }

  try {
    const { data } = await api(`/api/orders/${orderId}`);
    const order = data.order;

    if (order.status === 'pending_payment') {
      showPaymentPanel(order);
    } else if (order.status === 'pending_verification') {
      showStatusPanel(
        'Proof submitted!',
        'Our staff will verify your payment shortly. You can follow the progress on the order tracker.',
        order
      );
    } else if (order.status === 'cancelled') {
      showStatusPanel('Order cancelled', 'This order was cancelled — no payment is needed.', order);
    } else {
      showStatusPanel(
        'Payment arranged',
        'This order is already moving through the shop. Track it to see the current stage.',
        order
      );
    }
  } catch (error) {
    showToast(error.message, 'error');
    loadingEl.innerHTML = '<p>Could not load this order.</p>';
  }
}

/* ---------- Method toggle ---------- */

document.querySelectorAll('input[name="pay-method"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const isGcash = radio.value === 'gcash' && radio.checked;
    document.querySelector('#gcash-section').hidden = !isGcash;
    document.querySelector('#cash-section').hidden = isGcash;
  });
});

/* ---------- GCash proof upload ---------- */

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

submitProofButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  setBusy(submitProofButton, true, 'Uploading…');

  const body = new FormData();
  body.append('proof', selectedFile);

  try {
    const { message, data } = await api(`/api/orders/${orderId}/proof`, { method: 'POST', body });
    showToast(message, 'success');
    showStatusPanel(
      'Proof submitted!',
      'Our staff will verify your payment shortly. You can follow the progress on the order tracker.',
      data.order
    );
  } catch (error) {
    showToast(error.message, 'error');
    setBusy(submitProofButton, false);
  }
});

/* ---------- Cash on pickup ---------- */

const confirmCashButton = document.querySelector('#confirm-cash-btn');
confirmCashButton.addEventListener('click', async () => {
  setBusy(confirmCashButton, true, 'Confirming…');
  try {
    const { message, data } = await api(`/api/orders/${orderId}/payment-method`, {
      method: 'POST',
      body: { method: 'cash_on_pickup' },
    });
    showToast(message, 'success');
    showStatusPanel(
      'See you at the store!',
      'We are preparing your order now — pay at the counter when you collect it.',
      data.order
    );
  } catch (error) {
    showToast(error.message, 'error');
    setBusy(confirmCashButton, false);
  }
});

loadOrder();
