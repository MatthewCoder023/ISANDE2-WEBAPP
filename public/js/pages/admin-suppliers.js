/**
 * Supplier directory: who the shop buys from, and how much it has bought.
 *
 * Suppliers are archived rather than deleted — purchase orders point at them,
 * and removing the row would leave that history with only one end.
 */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { initModal } from '/js/modal.js';
import { formatPrice, escapeHtml, debounce } from '/js/format.js';

const state = { search: '', status: 'active' };

const tbody = document.querySelector('#suppliers-tbody');
const emptyState = document.querySelector('#empty-state');
const supplierModal = initModal(document.querySelector('#supplier-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));
const supplierForm = document.querySelector('#supplier-form');

const cache = new Map();
let confirmAction = null;

async function loadSuppliers() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ status: state.status });
  if (state.search) params.set('search', state.search);

  try {
    const { data } = await api(`/api/suppliers?${params}`);
    cache.clear();
    data.suppliers.forEach((supplier) => cache.set(supplier.id, supplier));
    renderTable(data.suppliers);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(suppliers) {
  emptyState.hidden = suppliers.length > 0;

  tbody.innerHTML = suppliers
    .map((supplier) => {
      const contact = [supplier.contactPerson, supplier.phone, supplier.email]
        .filter(Boolean)
        .map(escapeHtml)
        .join('<br />');

      const status = supplier.isActive
        ? '<span class="badge badge-dot badge-success">Active</span>'
        : '<span class="badge badge-dot badge-info">Archived</span>';

      return `
      <tr>
        <td>
          <div class="name">${escapeHtml(supplier.name)}</div>
          ${supplier.address ? `<div class="meta">${escapeHtml(supplier.address)}</div>` : ''}
        </td>
        <td>${contact || '<span class="text-muted">—</span>'}</td>
        <td>${supplier.paymentTerms ? escapeHtml(supplier.paymentTerms) : '<span class="text-muted">—</span>'}</td>
        <td class="num">${supplier.purchaseOrders}</td>
        <td class="num">${formatPrice(supplier.purchaseValue)}</td>
        <td>${status}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="${supplier.id}">Edit</button>
            ${
              supplier.isActive
                ? `<button type="button" class="btn btn-outline btn-sm" data-action="archive" data-id="${supplier.id}">Archive</button>`
                : `<button type="button" class="btn btn-outline btn-sm" data-action="restore" data-id="${supplier.id}">Restore</button>`
            }
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
    loadSuppliers();
  })
);

document.querySelector('#status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  loadSuppliers();
});

/* ---------- Create / edit ---------- */

function openSupplierModal(supplier = null) {
  clearFieldErrors(supplierForm);
  supplierForm.reset();
  supplierForm.supplierId.value = supplier ? supplier.id : '';
  document.querySelector('#supplier-modal-title').textContent = supplier
    ? 'Edit Supplier'
    : 'Add Supplier';

  if (supplier) {
    supplierForm.name.value = supplier.name;
    supplierForm.contactPerson.value = supplier.contactPerson || '';
    supplierForm.phone.value = supplier.phone || '';
    supplierForm.email.value = supplier.email || '';
    supplierForm.address.value = supplier.address || '';
    supplierForm.paymentTerms.value = supplier.paymentTerms || '';
  }

  supplierModal.open();
}

document.querySelector('#add-supplier-btn').addEventListener('click', () => openSupplierModal());

supplierForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(supplierForm);
  const saveButton = document.querySelector('#supplier-save-btn');
  setBusy(saveButton, true, 'Saving…');

  const supplierId = supplierForm.supplierId.value;
  const body = {
    name: supplierForm.name.value,
    contactPerson: supplierForm.contactPerson.value,
    phone: supplierForm.phone.value,
    email: supplierForm.email.value,
    address: supplierForm.address.value,
    paymentTerms: supplierForm.paymentTerms.value,
  };

  try {
    const result = supplierId
      ? await api(`/api/suppliers/${supplierId}`, { method: 'PATCH', body })
      : await api('/api/suppliers', { method: 'POST', body });
    showToast(result.message, 'success');
    supplierModal.close();
    loadSuppliers();
  } catch (error) {
    if (error.errors) showFieldErrors(supplierForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

/* ---------- Archive / restore ---------- */

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!confirmAction) return;
  try {
    const { message } = await confirmAction();
    showToast(message, 'success');
    loadSuppliers();
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

  const supplier = cache.get(button.dataset.id);
  if (!supplier) return;

  if (button.dataset.action === 'edit') {
    openSupplierModal(supplier);
    return;
  }

  if (button.dataset.action === 'restore') {
    confirmAction = () =>
      api(`/api/suppliers/${supplier.id}`, { method: 'PATCH', body: { isActive: true } });
    document.querySelector('#confirm-message').textContent =
      `Restore ${supplier.name} so purchase orders can be raised against them again?`;
    document.querySelector('#confirm-btn').textContent = 'Restore';
    confirmModal.open();
    return;
  }

  confirmAction = () => api(`/api/suppliers/${supplier.id}`, { method: 'DELETE' });
  document.querySelector('#confirm-message').textContent =
    `Archive ${supplier.name}? Their ${supplier.purchaseOrders} purchase order(s) stay exactly as they are — you just cannot raise new ones.`;
  document.querySelector('#confirm-btn').textContent = 'Archive';
  confirmModal.open();
});

loadSuppliers();
