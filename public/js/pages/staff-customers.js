/** Customer records for cashier/admin: directory with order history. */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDate, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { STATUS_BADGES } from '/js/orders-ui.js';

const state = { page: 1, search: '' };
const customersCache = new Map();

const tbody = document.querySelector('#customers-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const historyModal = initModal(document.querySelector('#history-modal'));
let historyCustomer = null;
let historyPage = 1;

/* ---------- Directory ---------- */

async function loadCustomers() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);

  try {
    const { data } = await api(`/api/customers?${params}`);
    renderTable(data.customers);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadCustomers();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(customers) {
  customersCache.clear();
  customers.forEach((c) => customersCache.set(c.id, c));

  emptyState.hidden = customers.length > 0;

  tbody.innerHTML = customers
    .map(
      (c) => `
      <tr>
        <td>
          <div class="product-cell" style="min-width: 170px;">
            <span class="dash-user-avatar" style="background-color: var(--primary-600);">
              ${escapeHtml(`${c.firstName[0] || ''}${c.lastName[0] || ''}`.toUpperCase())}
            </span>
            <div><div class="name">${escapeHtml(c.fullName)}</div></div>
          </div>
        </td>
        <td>
          ${escapeHtml(c.email)}
          ${c.phone ? `<div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(c.phone)}</div>` : ''}
        </td>
        <td>${formatDate(c.createdAt)}</td>
        <td>${c.orders}</td>
        <td class="num"><strong>${formatPrice(c.spent)}</strong></td>
        <td>${c.lastOrderAt ? formatDate(c.lastOrderAt) : '—'}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-outline btn-sm" data-action="history" data-id="${c.id}">View Orders</button>
          </div>
        </td>
      </tr>`
    )
    .join('');
}

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadCustomers();
  })
);

/* ---------- Order history modal ---------- */

async function loadHistory() {
  if (!historyCustomer) return;
  try {
    const { data } = await api(
      `/api/orders?customer=${historyCustomer.id}&page=${historyPage}&limit=8`
    );
    document.querySelector('#history-empty').hidden = data.orders.length > 0;
    document.querySelector('#history-tbody').innerHTML = data.orders
      .map(
        (o) => `
        <tr>
          <td><strong>${escapeHtml(o.orderNumber)}</strong></td>
          <td>${formatDateTime(o.createdAt)}</td>
          <td>${formatPrice(o.total)}</td>
          <td>${STATUS_BADGES[o.status] || escapeHtml(o.status)}</td>
        </tr>`
      )
      .join('');
    renderPagination(document.querySelector('#history-pagination'), data.pagination, (page) => {
      historyPage = page;
      loadHistory();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="history"]');
  if (!button) return;
  const customer = customersCache.get(button.dataset.id);
  if (!customer) return;

  historyCustomer = customer;
  historyPage = 1;
  document.querySelector('#history-customer-name').textContent = customer.fullName;
  document.querySelector('#history-customer-meta').textContent =
    `${customer.email} · ${customer.orders} order${customer.orders === 1 ? '' : 's'} · ${formatPrice(customer.spent)} lifetime`;
  document.querySelector('#history-tbody').innerHTML = '';
  historyModal.open();
  loadHistory();
});

loadCustomers();
