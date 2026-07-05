/**
 * Customer order history: track each order's progress, open its
 * invoice, pay pending ones, cancel while still awaiting payment.
 */
import { api } from '/js/api.js';
import { showToast, showFlashToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { STATUS_BADGES } from '/js/orders-ui.js';

const state = { page: 1, status: '' };
const ordersCache = new Map();

const tbody = document.querySelector('#orders-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const confirmModal = initModal(document.querySelector('#confirm-modal'));
let cancelOrderId = null;

async function loadOrders() {
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.status) params.set('status', state.status);

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

function renderTable(orders) {
  ordersCache.clear();
  orders.forEach((o) => ordersCache.set(o.id, o));

  emptyState.hidden = orders.length > 0;

  tbody.innerHTML = orders
    .map((o) => {
      const awaitingPayment = o.status === 'pending_payment';
      const payButton = awaitingPayment
        ? `<a class="btn btn-primary btn-sm" href="/client/payment?order=${o.id}">Pay Now</a>`
        : '';
      const cancelButton = awaitingPayment
        ? `<button class="btn btn-outline btn-sm" data-action="cancel" data-id="${o.id}">Cancel</button>`
        : '';
      return `
        <tr>
          <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
          <td>${formatDateTime(o.createdAt)}</td>
          <td>${o.itemCount} item${o.itemCount === 1 ? '' : 's'}</td>
          <td>${formatPrice(o.total)}</td>
          <td>${STATUS_BADGES[o.status] || escapeHtml(o.status)}</td>
          <td>
            <div class="cell-actions">
              <a class="btn btn-outline btn-sm" href="/client/track?order=${o.id}">Track</a>
              <a class="btn btn-outline btn-sm" href="/invoice?order=${o.id}">Invoice</a>
              ${payButton}
              ${cancelButton}
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

document.querySelector('#status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadOrders();
});

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="cancel"]');
  if (!button) return;
  const order = ordersCache.get(button.dataset.id);
  if (!order) return;

  cancelOrderId = order.id;
  document.querySelector('#confirm-message').textContent =
    `Cancel order ${order.orderNumber}? The items will go back on the shelf and this cannot be undone.`;
  confirmModal.open();
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

showFlashToast();
loadOrders();
