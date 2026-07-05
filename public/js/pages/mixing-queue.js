/**
 * Mixing queue for the paint mixer (and admin): work requests through
 * queued -> mixing -> completed, recording the formula used.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { icon, hydrateIcons } from '/js/icons.js';

const STATUS_BADGES = {
  queued: '<span class="badge badge-warning">Queued</span>',
  mixing: '<span class="badge badge-info">Mixing</span>',
  completed: '<span class="badge badge-success">Completed</span>',
  cancelled: '<span class="badge badge-danger">Cancelled</span>',
};

const UNITS = ['mL', 'g', 'parts', 'drops'];

const state = { page: 1, search: '', status: 'active' };
const requestsCache = new Map();

const tbody = document.querySelector('#queue-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const detailModal = initModal(document.querySelector('#detail-modal'));
const completeModal = initModal(document.querySelector('#complete-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));

const completeForm = document.querySelector('#complete-form');
let completeRequest = null;
let cancelRequestId = null;

/* ---------- List ---------- */

async function loadQueue() {
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.status) params.set('status', state.status);

  try {
    const { data } = await api(`/api/mixing/requests?${params}`);
    renderTable(data.requests);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadQueue();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function actionButtons(request) {
  const buttons = [
    `<button class="btn btn-outline btn-sm" data-action="view" data-id="${request.id}">View</button>`,
  ];
  if (request.status === 'queued') {
    buttons.push(
      `<button class="btn btn-primary btn-sm" data-action="start" data-id="${request.id}">Start Mixing</button>`
    );
  }
  if (request.status === 'mixing') {
    buttons.push(
      `<button class="btn btn-primary btn-sm" data-action="complete" data-id="${request.id}">Complete</button>`
    );
  }
  if (request.status === 'queued' || request.status === 'mixing') {
    buttons.push(
      `<button class="btn btn-outline btn-sm" data-action="cancel" data-id="${request.id}">Cancel</button>`
    );
  }
  return buttons.join('');
}

function renderTable(requests) {
  requestsCache.clear();
  requests.forEach((r) => requestsCache.set(r.id, r));

  emptyState.hidden = requests.length > 0;

  tbody.innerHTML = requests
    .map((r) => {
      const base = r.product
        ? `${escapeHtml(r.product.name)}${r.product.size ? ` (${escapeHtml(r.product.size)})` : ''}`
        : 'Mixer’s choice';
      return `
        <tr>
          <td><strong>${escapeHtml(r.requestNumber)}</strong></td>
          <td>
            <div class="product-cell" style="min-width: 130px;">
              <span class="swatch" style="background-color: ${escapeHtml(r.targetColor.hex)}"></span>
              <div>
                <div class="name">${escapeHtml(r.targetColor.name || r.targetColor.hex)}</div>
                ${r.targetColor.name ? `<div class="meta">${escapeHtml(r.targetColor.hex)}</div>` : ''}
              </div>
            </div>
          </td>
          <td>${escapeHtml(r.customerName || '—')}</td>
          <td>${base} × ${r.quantity}</td>
          <td>${formatDateTime(r.createdAt)}</td>
          <td>${STATUS_BADGES[r.status] || escapeHtml(r.status)}</td>
          <td><div class="cell-actions">${actionButtons(r)}</div></td>
        </tr>`;
    })
    .join('');
}

/* ---------- Filters ---------- */

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadQueue();
  })
);

document.querySelector('#status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadQueue();
});

/* ---------- Detail ---------- */

async function openDetail(id) {
  try {
    const { data } = await api(`/api/mixing/requests/${id}`);
    const r = data.request;

    const formulaBlock = r.formula
      ? `<p style="margin-top: 1rem;"><strong>Formula:</strong> ${escapeHtml(r.formula.name)}<br />
         <span class="text-muted" style="font-size: 0.875rem;">
           ${r.formula.components.map((c) => `${c.amount} ${escapeHtml(c.unit)} ${escapeHtml(c.name)}`).join(' + ')}
         </span></p>`
      : '';

    document.querySelector('#detail-body').innerHTML = `
      <div class="product-cell" style="margin-bottom: 1rem;">
        <span class="swatch" style="width: 48px; height: 48px; background-color: ${escapeHtml(r.targetColor.hex)}"></span>
        <div>
          <div class="name">${escapeHtml(r.targetColor.name || r.targetColor.hex)} ${STATUS_BADGES[r.status] || ''}</div>
          <div class="meta">${escapeHtml(r.requestNumber)} · ${escapeHtml(r.targetColor.hex)}</div>
        </div>
      </div>
      <p><strong>Customer:</strong> ${escapeHtml(r.customerName || '—')}</p>
      <p><strong>Base:</strong> ${r.product ? escapeHtml(r.product.name) : 'Mixer’s choice'} × ${r.quantity}</p>
      <p><strong>Requested:</strong> ${formatDateTime(r.createdAt)}</p>
      ${r.notes ? `<p style="margin-top: 0.75rem;"><strong>Customer notes:</strong> ${escapeHtml(r.notes)}</p>` : ''}
      ${r.mixerNotes ? `<p style="margin-top: 0.75rem;"><strong>Mixer notes:</strong> ${escapeHtml(r.mixerNotes)}</p>` : ''}
      ${formulaBlock}`;
    detailModal.open();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* ---------- Complete flow ---------- */

const formulaSelect = document.querySelector('#c-formula');
const newFormulaFields = document.querySelector('#new-formula-fields');
const componentsEl = document.querySelector('#nf-components');
let formulasLoaded = false;

async function loadFormulaOptions() {
  try {
    const { data } = await api('/api/formulas?limit=100&status=active');
    data.formulas.forEach((f) => {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = `${f.name} (${f.colorHex})`;
      formulaSelect.appendChild(option);
    });
    formulasLoaded = true;
  } catch {
    // Completing without a formula still works.
  }
}

function componentRow(name = '', amount = '', unit = 'mL') {
  return `
    <div class="repeat-row">
      <input class="form-input grow-2" type="text" placeholder="Pigment / tint" maxlength="50"
             data-component-name value="${escapeHtml(name)}" />
      <input class="form-input grow-1" type="number" placeholder="Amt" min="0.01" step="0.01"
             data-component-amount value="${amount}" />
      <select class="form-input form-select" data-component-unit style="width: 92px;">
        ${UNITS.map((u) => `<option value="${u}" ${u === unit ? 'selected' : ''}>${u}</option>`).join('')}
      </select>
      <button type="button" class="repeat-row-remove" data-remove-row aria-label="Remove component">×</button>
    </div>`;
}

document.querySelector('#nf-add-component').addEventListener('click', () => {
  componentsEl.insertAdjacentHTML('beforeend', componentRow());
});

componentsEl.addEventListener('click', (event) => {
  if (event.target.closest('[data-remove-row]')) {
    event.target.closest('.repeat-row').remove();
  }
});

formulaSelect.addEventListener('change', () => {
  newFormulaFields.hidden = formulaSelect.value !== '__new__';
});

function gatherComponents() {
  return [...componentsEl.querySelectorAll('.repeat-row')]
    .map((row) => ({
      name: row.querySelector('[data-component-name]').value.trim(),
      amount: parseFloat(row.querySelector('[data-component-amount]').value),
      unit: row.querySelector('[data-component-unit]').value,
    }))
    .filter((c) => c.name || !Number.isNaN(c.amount));
}

async function openCompleteModal(request) {
  clearFieldErrors(completeForm);
  completeForm.reset();
  completeRequest = request;

  document.querySelector('#complete-request-number').textContent = request.requestNumber;
  document.querySelector('#complete-color-hex').textContent =
    `${request.targetColor.name ? `${request.targetColor.name} · ` : ''}${request.targetColor.hex}`;
  document.querySelector('#complete-color-swatch').style.backgroundColor = request.targetColor.hex;

  componentsEl.innerHTML = componentRow();
  newFormulaFields.hidden = true;
  document.querySelector('#nf-name').value = request.targetColor.name || '';

  if (!formulasLoaded) await loadFormulaOptions();
  completeModal.open();
}

completeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!completeRequest) return;
  clearFieldErrors(completeForm);

  const body = { mixerNotes: document.querySelector('#c-notes').value };
  const choice = formulaSelect.value;

  if (choice === '__new__') {
    body.newFormula = {
      name: document.querySelector('#nf-name').value.trim(),
      colorHex: completeRequest.targetColor.hex,
      components: gatherComponents(),
    };
  } else if (choice) {
    body.formulaId = choice;
  }

  const submitButton = document.querySelector('#complete-submit-btn');
  setBusy(submitButton, true, 'Completing…');

  try {
    const { message } = await api(`/api/mixing/requests/${completeRequest.id}/complete`, {
      method: 'POST',
      body,
    });
    showToast(message, 'success');
    completeModal.close();
    completeRequest = null;
    formulasLoaded = false; // a new formula may now exist
    formulaSelect.querySelectorAll('option[value]:not([value=""]):not([value="__new__"])')
      .forEach((o) => o.remove());
    loadQueue();
  } catch (error) {
    if (error.errors) showFieldErrors(completeForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(submitButton, false);
  }
});

/* ---------- Table actions ---------- */

tbody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const request = requestsCache.get(button.dataset.id);
  if (!request) return;

  switch (button.dataset.action) {
    case 'view':
      openDetail(request.id);
      break;
    case 'start': {
      try {
        const { message } = await api(`/api/mixing/requests/${request.id}/start`, { method: 'POST' });
        showToast(message, 'success');
        loadQueue();
      } catch (error) {
        showToast(error.message, 'error');
      }
      break;
    }
    case 'complete':
      openCompleteModal(request);
      break;
    case 'cancel':
      cancelRequestId = request.id;
      document.querySelector('#confirm-message').textContent =
        `Cancel mix request ${request.requestNumber} for ${request.customerName || 'walk-in'}?`;
      confirmModal.open();
      break;
  }
});

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!cancelRequestId) return;
  try {
    const { message } = await api(`/api/mixing/requests/${cancelRequestId}/cancel`, { method: 'POST' });
    showToast(message, 'success');
    loadQueue();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    cancelRequestId = null;
    confirmModal.close();
  }
});

hydrateIcons();
loadQueue();
