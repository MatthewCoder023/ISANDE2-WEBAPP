/** Production history: completed and cancelled mix requests, read-only. */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';

const OUTCOME_BADGES = {
  completed: '<span class="badge badge-dot badge-success">Completed</span>',
  cancelled: '<span class="badge badge-dot badge-danger">Cancelled</span>',
};

const state = { page: 1, search: '' };

const tbody = document.querySelector('#log-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

async function loadLog() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10, status: 'history' });
  if (state.search) params.set('search', state.search);

  try {
    const { data } = await api(`/api/mixing/requests?${params}`);
    renderTable(data.requests);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadLog();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(requests) {
  emptyState.hidden = requests.length > 0;

  tbody.innerHTML = requests
    .map((r) => {
      const finished = r.completedAt || r.cancelledAt;
      return `
        <tr>
          <td><strong>${escapeHtml(r.requestNumber)}</strong></td>
          <td>
            <div class="product-cell" style="min-width: 120px;">
              <span class="swatch" style="background-color: ${escapeHtml(r.targetColor.hex)}"></span>
              <div>
                <div class="name">${escapeHtml(r.targetColor.name || r.targetColor.hex)}</div>
              </div>
            </div>
          </td>
          <td>${escapeHtml(r.customerName || '—')}</td>
          <td>${r.formula ? escapeHtml(r.formula.name) : '—'}</td>
          <td>${finished ? formatDateTime(finished) : '—'}</td>
          <td>${OUTCOME_BADGES[r.status] || escapeHtml(r.status)}</td>
          <td style="max-width: 220px;">${escapeHtml(r.mixerNotes || '—')}</td>
        </tr>`;
    })
    .join('');
}

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadLog();
  })
);

loadLog();
