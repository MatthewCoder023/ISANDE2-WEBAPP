/**
 * Staff order processing (cashier/admin): review payment proofs,
 * advance orders through verification → preparing → ready → completed,
 * take payment at handover for unpaid orders, cancel with stock
 * restoration.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { STATUS_BADGES, TYPE_LABELS, renderOrderDetail } from '/js/orders-ui.js';

const state = { page: 1, search: '', status: '', type: '' };
const ordersCache = new Map();

const tbody = document.querySelector('#orders-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const detailModal = initModal(document.querySelector('#detail-modal'));
const paymentModal = initModal(document.querySelector('#payment-modal'));
const reviewModal = initModal(document.querySelector('#review-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));

const paymentForm = document.querySelector('#payment-form');
let paymentOrder = null;
let reviewOrder = null;
let cancelOrderId = null;

/* ---------- List ---------- */

async function loadOrders() {
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.status) params.set('status', state.status);
  if (state.type) params.set('type', state.type);

  try {
    const { data } = await api(`/api/orders?${params}`);
    renderTable(data.orders);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadOrders();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function actionButtons(order) {
  const button = (action, label, primary = false) =>
    `<button class="btn ${primary ? 'btn-primary' : 'btn-outline'} btn-sm" data-action="${action}" data-id="${order.id}">${label}</button>`;

  const buttons = [button('view', 'View')];
  switch (order.status) {
    case 'pending_payment':
      buttons.push(button('complete', 'Take Payment', true), button('cancel', 'Cancel'));
      break;
    case 'pending_verification':
      buttons.push(button('review', 'Review Payment', true), button('cancel', 'Cancel'));
      break;
    case 'payment_verified':
      buttons.push(button('prepare', 'Start Preparing', true), button('cancel', 'Cancel'));
      break;
    case 'preparing':
      buttons.push(button('ready', 'Mark Ready', true), button('cancel', 'Cancel'));
      break;
    case 'ready':
      buttons.push(button('complete', 'Complete', true), button('cancel', 'Cancel'));
      break;
  }
  return buttons.join('');
}

function renderTable(orders) {
  ordersCache.clear();
  orders.forEach((o) => ordersCache.set(o.id, o));

  emptyState.hidden = orders.length > 0;

  tbody.innerHTML = orders
    .map(
      (o) => `
      <tr>
        <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
        <td>${formatDateTime(o.createdAt)}</td>
        <td>${escapeHtml(o.customerName || '—')}</td>
        <td>${o.itemCount}</td>
        <td>${formatPrice(o.total)}</td>
        <td>${TYPE_LABELS[o.type] || escapeHtml(o.type)}</td>
        <td>${STATUS_BADGES[o.status] || escapeHtml(o.status)}</td>
        <td><div class="cell-actions">${actionButtons(o)}</div></td>
      </tr>`
    )
    .join('');
}

/* ---------- Filters ---------- */

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadOrders();
  })
);

for (const [selector, key] of [
  ['#status-filter', 'status'],
  ['#type-filter', 'type'],
]) {
  document.querySelector(selector).addEventListener('change', (event) => {
    state[key] = event.target.value;
    state.page = 1;
    loadOrders();
  });
}

/* ---------- Payment modal ---------- */

function openPaymentModal(order) {
  clearFieldErrors(paymentForm);
  paymentForm.reset();
  paymentOrder = order;

  document.querySelector('#payment-order-number').textContent = order.orderNumber;
  document.querySelector('#payment-total').textContent = formatPrice(order.total);
  updatePaymentHint();
  paymentModal.open();
}

function updatePaymentHint() {
  const isCash = paymentForm.method.value === 'cash';
  document.querySelector('#pay-tendered-group').hidden = !isCash;

  const hint = document.querySelector('#pay-change-hint');
  if (!isCash || !paymentOrder) {
    hint.hidden = true;
    return;
  }
  const tendered = parseFloat(paymentForm.amountTendered.value);
  const valid = !Number.isNaN(tendered) && tendered >= paymentOrder.total;
  hint.hidden = !valid;
  if (valid) hint.textContent = `Change: ${formatPrice(tendered - paymentOrder.total)}`;
}

paymentForm.method.addEventListener('change', updatePaymentHint);
paymentForm.amountTendered.addEventListener('input', updatePaymentHint);

/* ---------- Review payment proof ---------- */

function openReviewModal(order) {
  reviewOrder = order;
  document.querySelector('#review-order-number').textContent = order.orderNumber;
  document.querySelector('#review-total').textContent = formatPrice(order.total);
  document.querySelector('#review-customer').textContent =
    `${order.customerName || 'Customer'} · GCash proof submitted`;
  document.querySelector('#review-reason').value = '';
  // Cache-bust so a re-uploaded proof always shows fresh.
  document.querySelector('#review-proof-img').src = `/api/orders/${order.id}/proof?t=${Date.now()}`;
  reviewModal.open();
}

document.querySelector('#verify-payment-btn').addEventListener('click', async () => {
  if (!reviewOrder) return;
  const button = document.querySelector('#verify-payment-btn');
  setBusy(button, true, 'Verifying…');
  try {
    const { message } = await api(`/api/orders/${reviewOrder.id}/verify-payment`, { method: 'POST' });
    showToast(message, 'success');
    reviewModal.close();
    reviewOrder = null;
    loadOrders();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
});

document.querySelector('#reject-payment-btn').addEventListener('click', async () => {
  if (!reviewOrder) return;
  const reason = document.querySelector('#review-reason').value.trim();
  if (!reason) {
    showToast('Add a short reason so the customer knows what to fix.', 'warning');
    return;
  }
  const button = document.querySelector('#reject-payment-btn');
  setBusy(button, true, 'Rejecting…');
  try {
    const { message } = await api(`/api/orders/${reviewOrder.id}/reject-payment`, {
      method: 'POST',
      body: { reason },
    });
    showToast(message, 'success');
    reviewModal.close();
    reviewOrder = null;
    loadOrders();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!paymentOrder) return;
  clearFieldErrors(paymentForm);

  const body = { method: paymentForm.method.value };
  if (body.method === 'cash') {
    body.amountTendered = parseFloat(paymentForm.amountTendered.value);
    if (Number.isNaN(body.amountTendered)) {
      showFieldErrors(paymentForm, [
        { field: 'amountTendered', message: 'Enter the amount tendered.' },
      ]);
      return;
    }
  }

  const submitButton = document.querySelector('#payment-submit-btn');
  setBusy(submitButton, true, 'Completing…');

  try {
    const { message, data } = await api(`/api/orders/${paymentOrder.id}/complete`, {
      method: 'POST',
      body,
    });
    const change = data.transaction.change;
    showToast(change > 0 ? `${message} Change: ${formatPrice(change)}` : message, 'success');
    paymentModal.close();
    paymentOrder = null;
    loadOrders();
  } catch (error) {
    if (error.errors) showFieldErrors(paymentForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(submitButton, false);
  }
});

/* ---------- Table actions ---------- */

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const order = ordersCache.get(button.dataset.id);
  if (!order) return;

  switch (button.dataset.action) {
    case 'view': {
      try {
        const { data } = await api(`/api/orders/${order.id}`);
        renderOrderDetail(document.querySelector('#detail-body'), data.order, data.transaction);
        detailModal.open();
      } catch (error) {
        showToast(error.message, 'error');
      }
      break;
    }
    case 'review':
      openReviewModal(order);
      break;
    case 'prepare':
    case 'ready': {
      const endpoint = button.dataset.action === 'prepare' ? 'prepare' : 'ready';
      try {
        const { message } = await api(`/api/orders/${order.id}/${endpoint}`, { method: 'POST' });
        showToast(message, 'success');
        loadOrders();
      } catch (error) {
        showToast(error.message, 'error');
      }
      break;
    }
    case 'complete': {
      // Verified-GCash orders are already paid — hand over directly.
      if (order.paidAt) {
        try {
          const { message } = await api(`/api/orders/${order.id}/complete`, {
            method: 'POST',
            body: {},
          });
          showToast(message, 'success');
          loadOrders();
        } catch (error) {
          showToast(error.message, 'error');
        }
      } else {
        openPaymentModal(order);
      }
      break;
    }
    case 'cancel':
      cancelOrderId = order.id;
      document.querySelector('#confirm-message').textContent =
        `Cancel order ${order.orderNumber}? Reserved stock will be restored to inventory.`;
      confirmModal.open();
      break;
  }
});

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!cancelOrderId) return;
  try {
    const { message } = await api(`/api/orders/${cancelOrderId}/cancel`, { method: 'POST' });
    showToast(message, 'success');
    loadOrders();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    cancelOrderId = null;
    confirmModal.close();
  }
});

loadOrders();
