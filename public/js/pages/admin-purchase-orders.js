/**
 * Purchase Orders: raise an order against a supplier, review it, send it,
 * and book the delivery in when it arrives.
 *
 * Receiving is the only action here that touches stock, and it posts the
 * quantities actually delivered — the server does the rest.
 */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { initModal } from '/js/modal.js';
import { formatPrice, formatDate, formatDateTime, escapeHtml, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { applyUrlFilters } from '/js/url-filters.js';
import { countUp } from '/js/count-up.js';

const STATUS_BADGES = {
  draft: '<span class="badge badge-dot badge-info">Draft</span>',
  ordered: '<span class="badge badge-dot badge-warning">Ordered</span>',
  received: '<span class="badge badge-dot badge-success">Received</span>',
  cancelled: '<span class="badge badge-dot badge-danger">Cancelled</span>',
};

const state = { page: 1, search: '', status: '' };

const tbody = document.querySelector('#po-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const poModal = initModal(document.querySelector('#po-modal'));
const detailModal = initModal(document.querySelector('#po-detail-modal'));
const receiveModal = initModal(document.querySelector('#receive-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));

const poForm = document.querySelector('#po-form');
const receiveForm = document.querySelector('#receive-form');
const linesBody = document.querySelector('#po-lines');

/** The order being built, and the catalogue it draws from. */
let draftLines = [];
let catalogue = [];
let receivingPo = null;
let confirmAction = null;

/* ---------- List ---------- */

async function loadStats() {
  try {
    const { data } = await api('/api/purchase-orders/stats');
    countUp(document.querySelector('[data-stat="openOrders"]'), data.stats.openOrders);
    countUp(document.querySelector('[data-stat="receivedOrders"]'), data.stats.receivedOrders);
    countUp(
      document.querySelector('[data-stat="outstandingValue"]'),
      data.stats.outstandingValue,
      formatPrice
    );
  } catch {
    // Tiles keep their placeholder; the table below is the real content.
  }
}

async function loadPurchaseOrders() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.status) params.set('status', state.status);

  try {
    const { data } = await api(`/api/purchase-orders?${params}`);
    renderTable(data.purchaseOrders);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadPurchaseOrders();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(purchaseOrders) {
  emptyState.hidden = purchaseOrders.length > 0;

  tbody.innerHTML = purchaseOrders
    .map((po) => {
      const units = po.items.reduce((sum, item) => sum + item.quantityOrdered, 0);
      return `
      <tr>
        <td><strong>${escapeHtml(po.poNumber)}</strong></td>
        <td>${escapeHtml(po.supplierName)}</td>
        <td>${formatDate(po.createdAt)}</td>
        <td>${po.items.length} line${po.items.length === 1 ? '' : 's'} · ${units} units</td>
        <td class="num"><strong>${formatPrice(po.total)}</strong></td>
        <td>${STATUS_BADGES[po.status] || escapeHtml(po.status)}</td>
        <td>
          <div class="table-actions">
            <button type="button" class="btn btn-outline btn-sm" data-action="view" data-id="${po.id}">View</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadPurchaseOrders();
  })
);

document.querySelector('#status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadPurchaseOrders();
});

/* ---------- Building an order ---------- */

/**
 * Products that can be ordered from a supplier. Custom mixes are excluded
 * server-side too, but leaving them out of the picker means nobody has to
 * discover that by being refused.
 */
async function loadCatalogue() {
  const { data } = await api('/api/products?status=active&limit=200&sort=name');
  catalogue = data.products.filter((product) => !product.isCustom);

  // Whatever is closest to running out is what someone opening this page is
  // most likely here to reorder.
  const byUrgency = [...catalogue].sort((a, b) => {
    const ratio = (p) => (p.stock?.quantity ?? 0) / Math.max(p.stock?.lowStockThreshold ?? 1, 1);
    return ratio(a) - ratio(b);
  });

  const select = document.querySelector('#po-add-product');
  select.innerHTML = '<option value="">Add a product…</option>';
  for (const product of byUrgency) {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} (${product.sku}) — ${product.stock.quantity} in stock`;
    select.appendChild(option);
  }
}

async function loadSuppliers() {
  const { data } = await api('/api/suppliers');
  const select = document.querySelector('#po-supplier');
  select.innerHTML = '<option value="">Choose a supplier…</option>';
  for (const supplier of data.suppliers) {
    const option = document.createElement('option');
    option.value = supplier.id;
    option.textContent = supplier.name;
    select.appendChild(option);
  }

  if (data.suppliers.length === 0) {
    showToast('Add a supplier first — a purchase order needs somewhere to send it.', 'warning');
  }
}

function renderLines() {
  linesBody.innerHTML = draftLines
    .map((line, index) => {
      const product = catalogue.find((p) => p.id === line.productId);
      const subtotal = line.unitCost * line.quantity;
      return `
      <tr>
        <td>
          <div class="name">${escapeHtml(product?.name || 'Unknown product')}</div>
          <div class="meta"><span class="sku">${escapeHtml(product?.sku || '')}</span></div>
        </td>
        <td class="num">${product?.stock?.quantity ?? '—'}</td>
        <td class="num">
          <input class="form-input" type="number" min="0" step="0.01" style="width: 7rem;"
                 value="${line.unitCost}" data-line="${index}" data-field="unitCost"
                 aria-label="Unit cost for ${escapeHtml(product?.name || '')}" />
        </td>
        <td class="num">
          <input class="form-input" type="number" min="1" step="1" style="width: 5.5rem;"
                 value="${line.quantity}" data-line="${index}" data-field="quantity"
                 aria-label="Quantity for ${escapeHtml(product?.name || '')}" />
        </td>
        <td class="num"><strong>${formatPrice(subtotal)}</strong></td>
        <td>
          <button type="button" class="btn btn-outline btn-sm" data-remove="${index}"
                  aria-label="Remove ${escapeHtml(product?.name || '')}">Remove</button>
        </td>
      </tr>`;
    })
    .join('');

  const total = draftLines.reduce((sum, line) => sum + line.unitCost * line.quantity, 0);
  document.querySelector('#po-total').textContent = formatPrice(total);
}

document.querySelector('#po-add-line').addEventListener('click', () => {
  const select = document.querySelector('#po-add-product');
  const productId = select.value;
  if (!productId) return;

  const product = catalogue.find((p) => p.id === productId);
  const existing = draftLines.find((line) => line.productId === productId);
  if (existing) existing.quantity += 1;
  else draftLines.push({ productId, quantity: 1, unitCost: product?.price ?? 0 });

  select.value = '';
  renderLines();
});

linesBody.addEventListener('input', (event) => {
  const input = event.target.closest('input[data-line]');
  if (!input) return;
  const line = draftLines[Number(input.dataset.line)];
  if (!line) return;

  const value = Number(input.value);
  if (input.dataset.field === 'quantity') line.quantity = Math.max(1, Math.round(value) || 1);
  else line.unitCost = Math.max(0, value || 0);

  // Only the totals are recomputed: re-rendering the table here would take
  // focus out of the field being typed in.
  const total = draftLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0);
  document.querySelector('#po-total').textContent = formatPrice(total);
  const cell = input.closest('tr').querySelector('td:nth-child(5) strong');
  if (cell) cell.textContent = formatPrice(line.unitCost * line.quantity);
});

linesBody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  draftLines.splice(Number(button.dataset.remove), 1);
  renderLines();
});

async function openPoModal() {
  clearFieldErrors(poForm);
  poForm.reset();
  draftLines = [];
  renderLines();

  try {
    await Promise.all([loadSuppliers(), loadCatalogue()]);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  poModal.open();
}

document.querySelector('#new-po-btn').addEventListener('click', openPoModal);

async function submitPo(status, button) {
  clearFieldErrors(poForm);

  if (draftLines.length === 0) {
    showFieldErrors(poForm, { items: 'Add at least one item to the purchase order.' });
    return;
  }

  setBusy(button, true, 'Saving…');
  try {
    const { message } = await api('/api/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: poForm.supplierId.value,
        expectedDate: poForm.expectedDate.value || null,
        notes: poForm.notes.value,
        status,
        items: draftLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      },
    });
    showToast(message, 'success');
    poModal.close();
    loadPurchaseOrders();
    loadStats();
  } catch (error) {
    if (error.errors) showFieldErrors(poForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

poForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitPo('ordered', document.querySelector('#po-place-btn'));
});

document.querySelector('#po-save-draft').addEventListener('click', () => {
  submitPo('draft', document.querySelector('#po-save-draft'));
});

/* ---------- Detail ---------- */

async function openDetail(id) {
  try {
    const { data } = await api(`/api/purchase-orders/${id}`);
    const po = data.purchaseOrder;
    renderDetail(po);
    detailModal.open();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderDetail(po) {
  document.querySelector('#po-detail-title').textContent = po.poNumber;

  const rows = po.items
    .map(
      (item) => `
      <tr>
        <td>
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="meta"><span class="sku">${escapeHtml(item.sku)}</span></div>
        </td>
        <td class="num">${formatPrice(item.unitCost)}</td>
        <td class="num">${item.quantityOrdered}</td>
        <td class="num">${item.quantityReceived === null ? '—' : item.quantityReceived}</td>
        <td class="num"><strong>${formatPrice(item.lineTotal)}</strong></td>
      </tr>`
    )
    .join('');

  const detail = (label, value) =>
    value ? `<div><span class="text-muted">${label}:</span> ${escapeHtml(String(value))}</div>` : '';

  document.querySelector('#po-detail-body').innerHTML = `
    <div style="display: grid; gap: 0.375rem; margin-bottom: 1.25rem; font-size: 0.9375rem;">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <strong>${escapeHtml(po.supplierName)}</strong>
        ${STATUS_BADGES[po.status] || ''}
      </div>
      ${detail('Raised', formatDateTime(po.createdAt))}
      ${detail('Expected', po.expectedDate ? formatDate(po.expectedDate) : '')}
      ${detail('Received', po.receivedAt ? formatDateTime(po.receivedAt) : '')}
      ${detail('Notes', po.notes)}
      ${detail('Cancelled because', po.cancelledReason)}
    </div>

    <div class="table-wrap">
      <table class="table" aria-label="Purchase order items">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" class="num">Unit cost</th>
            <th scope="col" class="num">Ordered</th>
            <th scope="col" class="num">Received</th>
            <th scope="col" class="num">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="po-total-row"><span>Order total</span><strong>${formatPrice(po.total)}</strong></div>`;

  const open = po.status === 'draft' || po.status === 'ordered';
  document.querySelector('#po-detail-actions').innerHTML = `
    <a class="btn btn-outline" href="/api/purchase-orders/${po.id}/document.pdf"
       target="_blank" rel="noopener">Download PDF</a>
    ${open ? `<button type="button" class="btn btn-outline" data-po-action="cancel" data-id="${po.id}">Cancel Order</button>` : ''}
    ${po.status === 'draft' ? `<button type="button" class="btn btn-outline" data-po-action="order" data-id="${po.id}">Mark as Ordered</button>` : ''}
    ${open ? `<button type="button" class="btn btn-primary" data-po-action="receive" data-id="${po.id}">Receive Delivery</button>` : ''}`;
}

/* ---------- Receiving ---------- */

function openReceive(po) {
  receivingPo = po;
  document.querySelector('#receive-lines').innerHTML = po.items
    .map(
      (item, index) => `
      <tr>
        <td>
          <div class="name">${escapeHtml(item.name)}</div>
          <div class="meta"><span class="sku">${escapeHtml(item.sku)}</span></div>
        </td>
        <td class="num">${item.quantityOrdered}</td>
        <td class="num">
          <input class="form-input" type="number" min="0" max="${item.quantityOrdered}" step="1"
                 style="width: 6rem;" value="${item.quantityOrdered}" data-receive="${index}"
                 aria-label="Quantity received of ${escapeHtml(item.name)}" />
        </td>
      </tr>`
    )
    .join('');
  receiveModal.open();
}

receiveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#receive-btn');
  setBusy(button, true, 'Receiving…');

  const items = receivingPo.items.map((item, index) => ({
    sku: item.sku,
    quantityReceived: Number(
      document.querySelector(`[data-receive="${index}"]`).value || 0
    ),
  }));

  try {
    const { message } = await api(`/api/purchase-orders/${receivingPo.id}/receive`, {
      method: 'POST',
      body: { items },
    });
    showToast(message, 'success');
    receiveModal.close();
    detailModal.close();
    loadPurchaseOrders();
    loadStats();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
});

/* ---------- Actions ---------- */

function openConfirm(message, label, action) {
  document.querySelector('#confirm-message').textContent = message;
  document.querySelector('#confirm-btn').textContent = label;
  confirmAction = action;
  confirmModal.open();
}

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!confirmAction) return;
  try {
    await confirmAction();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    confirmAction = null;
    confirmModal.close();
  }
});

document.querySelector('#po-detail-actions').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-po-action]');
  if (!button) return;

  const { poAction, id } = button.dataset;
  const { data } = await api(`/api/purchase-orders/${id}`);
  const po = data.purchaseOrder;

  if (poAction === 'receive') {
    openReceive(po);
    return;
  }

  if (poAction === 'order') {
    const { message } = await api(`/api/purchase-orders/${id}/order`, { method: 'POST' });
    showToast(message, 'success');
    detailModal.close();
    loadPurchaseOrders();
    loadStats();
    return;
  }

  if (poAction === 'cancel') {
    openConfirm(
      `Cancel ${po.poNumber}? No stock has moved, so nothing is unwound — the order is simply closed.`,
      'Cancel Order',
      async () => {
        const { message } = await api(`/api/purchase-orders/${id}/cancel`, { method: 'POST' });
        showToast(message, 'success');
        detailModal.close();
        loadPurchaseOrders();
        loadStats();
      }
    );
  }
});

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="view"]');
  if (button) openDetail(button.dataset.id);
});

/* ---------- Init ---------- */

Object.assign(state, applyUrlFilters({ status: '#status-filter' }));
loadStats();
loadPurchaseOrders();
