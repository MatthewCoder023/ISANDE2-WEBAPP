/** Payment log for cashier/admin: searchable, filterable, paginated. */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';
import { applyUrlFilters } from '/js/url-filters.js';
import { initTableSort } from '/js/table-sort.js';

const state = { page: 1, search: '', method: '', sort: 'newest' };

const tbody = document.querySelector('#transactions-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const paintSort = initTableSort(document.querySelector('#transactions-thead'), (sort) => {
  state.sort = sort;
  state.page = 1;
  loadTransactions();
});

async function loadTransactions() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.method) params.set('method', state.method);
  params.set('sort', state.sort);

  try {
    const { data } = await api(`/api/transactions?${params}`);
    renderTable(data.transactions);
    paintSort(state.sort);
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
        <td><a class="btn btn-outline btn-sm" href="/invoice?order=${encodeURIComponent(t.order)}" target="_blank" rel="noopener">Invoice</a></td>
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
function exportParams() {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.method) params.set('method', state.method);
  return params;
}

// CSV stays the raw-data export; the workbook is branded and locked for
// anything that gets passed on to someone else.
document.querySelector('#export-btn').addEventListener('click', () => {
  window.location.assign(`/api/transactions/export?${exportParams()}`);
});

document.querySelector('#export-xlsx-btn')?.addEventListener('click', () => {
  window.location.assign(`/api/transactions/export.xlsx?${exportParams()}`);
});

// Honour ?method= so a deep link opens the payments it refers to.
Object.assign(state, applyUrlFilters({ method: '#method-filter' }));
loadTransactions();
