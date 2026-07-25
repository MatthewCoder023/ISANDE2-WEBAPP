/** Payment log for cashier/admin: searchable, filterable, paginated. */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';
import { applyUrlFilters } from '/js/url-filters.js';

const state = { page: 1, search: '', method: '' };

const tbody = document.querySelector('#transactions-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

async function loadTransactions() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.method) params.set('method', state.method);

  try {
    const { data } = await api(`/api/transactions?${params}`);
    renderTable(data.transactions);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadTransactions();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(transactions) {
  emptyState.hidden = transactions.length > 0;

  tbody.innerHTML = transactions
    .map(
      (t) => `
      <tr>
        <td>${formatDateTime(t.createdAt)}</td>
        <td><strong>${escapeHtml(t.orderNumber)}</strong></td>
        <td>${PAYMENT_LABELS[t.method] || escapeHtml(t.method)}</td>
        <td class="num"><strong>${formatPrice(t.amount)}</strong></td>
        <td class="num">${formatPrice(t.amountTendered)}</td>
        <td class="num">${formatPrice(t.change)}</td>
        <td>${t.receivedBy ? escapeHtml(t.receivedBy.fullName) : '—'}</td>
      </tr>`
    )
    .join('');
}

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadTransactions();
  })
);

document.querySelector('#method-filter').addEventListener('change', (event) => {
  state.method = event.target.value;
  state.page = 1;
  loadTransactions();
});

// CSV download honors the current filters; navigation keeps the session cookie.
document.querySelector('#export-btn').addEventListener('click', () => {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.method) params.set('method', state.method);
  window.location.assign(`/api/transactions/export?${params}`);
});

// Honour ?method= so a deep link opens the payments it refers to.
Object.assign(state, applyUrlFilters({ method: '#method-filter' }));
loadTransactions();
