/** Payment log for cashier/admin: searchable, filterable, paginated. */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';

const state = { page: 1, search: '', method: '' };

const tbody = document.querySelector('#transactions-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

async function loadTransactions() {
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
        <td><strong>${formatPrice(t.amount)}</strong></td>
        <td>${formatPrice(t.amountTendered)}</td>
        <td>${formatPrice(t.change)}</td>
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

loadTransactions();
