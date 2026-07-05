/**
 * Customer order history: list own orders, view details,
 * cancel while still pending.
 */
import { api } from '/js/api.js';
import { showToast, showFlashToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { STATUS_BADGES, renderOrderDetail } from '/js/orders-ui.js';

const state = { page: 1, status: '' };
const ordersCache = new Map();

const tbody = document.querySelector('#orders-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const detailModal = initModal(document.querySelector('#detail-modal'));
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
      const cancelButton =
        o.status === 'pending'
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
              <button class="btn btn-outline btn-sm" data-action="view" data-id="${o.id}">View</button>
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

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const order = ordersCache.get(button.dataset.id);
  if (!order) return;

  if (button.dataset.action === 'view') {
    try {
      const { data } = await api(`/api/orders/${order.id}`);
      renderOrderDetail(document.querySelector('#detail-body'), data.order, data.transaction);
      detailModal.open();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  if (button.dataset.action === 'cancel') {
    cancelOrderId = order.id;
    document.querySelector('#confirm-message').textContent =
      `Cancel order ${order.orderNumber}? The items will go back on the shelf and this cannot be undone.`;
    confirmModal.open();
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

showFlashToast();
loadOrders();
