/** Formula library for the paint mixer (and admin). */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { hydrateIcons } from '/js/icons.js';

const UNITS = ['mL', 'g', 'parts', 'drops'];

const state = { page: 1, search: '', status: 'active' };
const formulasCache = new Map();

const tbody = document.querySelector('#formulas-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const formulaModal = initModal(document.querySelector('#formula-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));
const formulaForm = document.querySelector('#formula-form');
const componentsEl = document.querySelector('#f-components');
let confirmAction = null;

/* ---------- List ---------- */

async function loadFormulas() {
  tableSkeleton(tbody, 6);
  const params = new URLSearchParams({ page: state.page, limit: 10, status: state.status });
  if (state.search) params.set('search', state.search);

  try {
    const { data } = await api(`/api/formulas?${params}`);
    renderTable(data.formulas);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadFormulas();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

const recipeSummary = (components) =>
  components.map((c) => `${c.amount} ${escapeHtml(c.unit)} ${escapeHtml(c.name)}`).join(' + ');

function renderTable(formulas) {
  formulasCache.clear();
  formulas.forEach((f) => formulasCache.set(f.id, f));

  emptyState.hidden = formulas.length > 0;

  tbody.innerHTML = formulas
    .map((f) => {
      const statusBadge = f.isActive
        ? '<span class="badge badge-dot badge-success">Active</span>'
        : '<span class="badge badge-dot badge-info">Archived</span>';
      const archiveButton = f.isActive
        ? `<button class="btn btn-outline btn-sm" data-action="archive" data-id="${f.id}">Archive</button>`
        : `<button class="btn btn-primary btn-sm" data-action="restore" data-id="${f.id}">Restore</button>`;
      return `
        <tr>
          <td>
            <div class="product-cell" style="min-width: 160px;">
              <span class="swatch" style="background-color: ${escapeHtml(f.colorHex)}"></span>
              <div>
                <div class="name">${escapeHtml(f.name)}</div>
                <div class="meta">${escapeHtml(f.colorHex)}</div>
              </div>
            </div>
          </td>
          <td style="max-width: 280px;">${recipeSummary(f.components)}</td>
          <td>${f.timesUsed}</td>
          <td>${f.createdBy ? escapeHtml(f.createdBy.fullName) : '—'}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="cell-actions">
              <button class="btn btn-outline btn-sm" data-action="edit" data-id="${f.id}">Edit</button>
              ${archiveButton}
            </div>
          </td>
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
    loadFormulas();
  })
);

document.querySelector('#status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadFormulas();
});

/* ---------- Component rows ---------- */

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

document.querySelector('#f-add-component').addEventListener('click', () => {
  componentsEl.insertAdjacentHTML('beforeend', componentRow());
});

componentsEl.addEventListener('click', (event) => {
  if (event.target.closest('[data-remove-row]')) {
    event.target.closest('.repeat-row').remove();
  }
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

/* ---------- Create / edit ---------- */

function openFormulaModal(formula = null) {
  clearFieldErrors(formulaForm);
  formulaForm.reset();
  formulaForm.formulaId.value = formula ? formula.id : '';

  document.querySelector('#formula-modal-title').textContent = formula
    ? 'Edit Formula'
    : 'New Formula';

  if (formula) {
    formulaForm.name.value = formula.name;
    formulaForm.colorHex.value = formula.colorHex;
    formulaForm.notes.value = formula.notes || '';
    componentsEl.innerHTML = formula.components
      .map((c) => componentRow(c.name, c.amount, c.unit))
      .join('');
  } else {
    componentsEl.innerHTML = componentRow();
  }

  formulaModal.open();
}

document.querySelector('#add-formula-btn').addEventListener('click', () => openFormulaModal());

formulaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(formulaForm);

  const formulaId = formulaForm.formulaId.value;
  const body = {
    name: formulaForm.name.value,
    colorHex: formulaForm.colorHex.value,
    components: gatherComponents(),
    notes: formulaForm.notes.value,
  };

  const saveButton = document.querySelector('#formula-save-btn');
  setBusy(saveButton, true, 'Saving…');

  try {
    const result = formulaId
      ? await api(`/api/formulas/${formulaId}`, { method: 'PATCH', body })
      : await api('/api/formulas', { method: 'POST', body });
    showToast(result.message, 'success');
    formulaModal.close();
    loadFormulas();
  } catch (error) {
    if (error.errors) showFieldErrors(formulaForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

/* ---------- Archive / restore ---------- */

function openConfirm(message, buttonLabel, buttonClass, action) {
  document.querySelector('#confirm-message').textContent = message;
  const button = document.querySelector('#confirm-btn');
  button.textContent = buttonLabel;
  button.className = `btn ${buttonClass}`;
  confirmAction = action;
  confirmModal.open();
}

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!confirmAction) return;
  try {
    const { message } = await confirmAction();
    showToast(message, 'success');
    loadFormulas();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    confirmAction = null;
    confirmModal.close();
  }
});

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const formula = formulasCache.get(button.dataset.id);
  if (!formula) return;

  switch (button.dataset.action) {
    case 'edit':
      openFormulaModal(formula);
      break;
    case 'archive':
      openConfirm(
        `Archive "${formula.name}"? Past mixes keep their reference; it just leaves the picker.`,
        'Archive',
        'btn-danger',
        () => api(`/api/formulas/${formula.id}`, { method: 'DELETE' })
      );
      break;
    case 'restore':
      openConfirm(
        `Restore "${formula.name}" to the active library?`,
        'Restore',
        'btn-primary',
        () => api(`/api/formulas/${formula.id}`, { method: 'PATCH', body: { isActive: true } })
      );
      break;
  }
});

hydrateIcons();
loadFormulas();
