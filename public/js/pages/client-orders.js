/**
 * Customer order history: track each order's progress, open its
 * sales invoice, pay pending ones, cancel while still awaiting payment.
 */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast, showFlashToast, flashToast } from '/js/toast.js';
import { setBusy } from '/js/form-utils.js';
import { getCurrentUser } from '/js/session.js';
import { addItem } from '/js/cart.js';
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { STATUS_BADGES } from '/js/orders-ui.js';
import { applyUrlFilters } from '/js/url-filters.js';

const state = { page: 1, status: '' };
let userId = null;
const ordersCache = new Map();

const tbody = document.querySelector('#orders-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const confirmModal = initModal(document.querySelector('#confirm-modal'));
let cancelOrderId = null;

async function loadOrders() {
  tableSkeleton(tbody, 6);
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
        ? `<a class="btn btn-primary btn-sm" href="/client/track?order=${o.id}">Pay Now</a>`
        : '';
      const cancelButton = awaitingPayment
        ? `<button class="btn btn-outline btn-sm" data-action="cancel" data-id="${o.id}">Cancel</button>`
        : '';
      // Rebuying a finished order shouldn't mean hunting down each paint again.
      const reorderButton = ['completed', 'cancelled'].includes(o.status)
        ? `<button class="btn btn-outline btn-sm" data-action="reorder" data-id="${o.id}">Order Again</button>`
        : '';
      return `
        <tr>
          <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
          <td>${formatDateTime(o.createdAt)}</td>
          <td>${o.itemCount} item${o.itemCount === 1 ? '' : 's'}</td>
          <td class="num">${formatPrice(o.total)}</td>
          <td>${STATUS_BADGES[o.status] || escapeHtml(o.status)}</td>
          <td>
            <div class="cell-actions">
              <a class="btn btn-outline btn-sm" href="/client/track?order=${o.id}">Track</a>
              <a class="btn btn-outline btn-sm" href="/invoice?order=${o.id}">View Sales Invoice</a>
              ${payButton}
              ${reorderButton}
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

/**
 * Rebuilds a past order in the cart. Items that have since been archived or
 * sold out are skipped and reported rather than silently dropped — and a
 * one-off custom mix that has already been bought simply cannot repeat.
 */
async function reorder(order, button) {
  if (!order || !userId) return;
  setBusy(button, true, 'Adding…');

  const skipped = [];
  let added = 0;

  for (const item of order.items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await api(`/api/products/${item.product}`);
      // Customers see availability rather than a stock count.
      if (data.product.availability === 'out_of_stock') {
        skipped.push(`${item.name} (out of stock)`);
        continue;
      }
      addItem(userId, data.product, item.quantity);
      added += 1;
    } catch {
      skipped.push(`${item.name} (no longer available)`);
    }
  }

  setBusy(button, false);

  if (added === 0) {
    showToast('None of those items can be reordered right now.', 'warning');
    return;
  }
  if (skipped.length > 0) {
    showToast(`Added ${added} item${added === 1 ? '' : 's'}. Skipped: ${skipped.join(', ')}.`, 'warning');
  }
  flashToast(`Added ${added} item${added === 1 ? '' : 's'} to your cart.`, 'success');
  window.location.assign('/client/checkout');
}

tbody.addEventListener('click', async (event) => {
  const reorderButton = event.target.closest('button[data-action="reorder"]');
  if (reorderButton) {
    await reorder(ordersCache.get(reorderButton.dataset.id), reorderButton);
    return;
  }

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
// Honour ?status= so the dashboard tiles land on the orders they counted.
Object.assign(state, applyUrlFilters({ status: '#status-filter' }));
loadOrders();

// Needed only by "Order Again", so it can trail the first paint.
getCurrentUser().then((user) => {
  userId = user.id;
});
