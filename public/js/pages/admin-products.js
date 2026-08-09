/**
 * Admin Products & Inventory page: catalog table with filters,
 * create/edit modal, stock adjustment modal, archive/restore.
 *
 * Display-only copies of the product taxonomy — keep in sync with
 * src/constants/products.js (the server is the enforcing side).
 */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { initModal } from '/js/modal.js';
import { formatPrice, formatDate, escapeHtml, debounce } from '/js/format.js';
import { icon } from '/js/icons.js';
import { renderPagination } from '/js/pagination.js';
import { applyUrlFilters } from '/js/url-filters.js';
import { initRowMenus } from '/js/row-menu.js';

const CATEGORY_LABELS = {
  interior: 'Interior Paint',
  exterior: 'Exterior Paint',
  primer: 'Primers & Sealers',
  enamel: 'Enamel & Wood/Metal',
  spray: 'Spray Paint',
  supplies: 'Tools & Supplies',
};
const FINISHES = ['flat', 'matte', 'eggshell', 'satin', 'semi-gloss', 'gloss'];
const SIZES = ['250mL', '500mL', '1L', '4L', '16L'];

const AVAILABILITY_BADGES = {
  low_stock: '<span class="badge badge-dot badge-warning">Low</span>',
  out_of_stock: '<span class="badge badge-dot badge-danger">Out</span>',
};

const state = { page: 1, search: '', category: '', status: 'active', stock: '' };
const productsCache = new Map();

const tbody = document.querySelector('#products-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const productModal = initModal(document.querySelector('#product-modal'));
const stockModal = initModal(document.querySelector('#stock-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));

const productForm = document.querySelector('#product-form');
const stockForm = document.querySelector('#stock-form');
let confirmAction = null;
let stockProductId = null;

/* ---------- Dropdown population ---------- */

function fillSelect(select, entries, keepFirst = true) {
  const first = keepFirst ? select.firstElementChild : null;
  select.innerHTML = '';
  if (first) select.appendChild(first);
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

fillSelect(document.querySelector('#category-filter'), Object.entries(CATEGORY_LABELS));
fillSelect(document.querySelector('#p-category'), Object.entries(CATEGORY_LABELS), false);
fillSelect(document.querySelector('#p-finish'), FINISHES.map((f) => [f, f]));
fillSelect(document.querySelector('#p-size'), SIZES.map((s) => [s, s]));

/* ---------- Product list ---------- */

async function loadProducts() {
  tableSkeleton(tbody, 7);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.category) params.set('category', state.category);
  if (state.status) params.set('status', state.status);
  if (state.stock) params.set('stock', state.stock);

  try {
    const { data } = await api(`/api/products?${params}`);
    renderTable(data.products);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadProducts();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function swatchHtml(product) {
  if (product.color?.hex) {
    return `<span class="swatch" data-finish="${escapeHtml(product.finish || '')}"
                  style="background-color: ${escapeHtml(product.color.hex)}"></span>`;
  }
  return `<span class="swatch">${icon('brush', 18)}</span>`;
}

function renderTable(products) {
  productsCache.clear();
  products.forEach((p) => productsCache.set(p.id, p));

  emptyState.hidden = products.length > 0;
  // Delegated to the tbody, so replacing its contents below needs no rebind.
  initRowMenus(tbody);

  tbody.innerHTML = products
    .map((p) => {
      const meta = [p.color?.name, p.finish, p.size].filter(Boolean).map(escapeHtml).join(' · ');
      const availabilityBadge = AVAILABILITY_BADGES[p.availability] || '';
      const statusBadge = p.isActive
        ? '<span class="badge badge-dot badge-success">Active</span>'
        : '<span class="badge badge-dot badge-info">Archived</span>';
      const archiveItem = p.isActive
        ? `<button role="menuitem" data-action="archive" data-id="${p.id}">Archive product</button>`
        : `<button role="menuitem" data-action="restore" data-id="${p.id}">Restore product</button>`;

      /**
       * The SKU rides under the name rather than holding a column of its
       * own. It is a lookup key, not something you scan down a table — and
       * as a column it wrapped onto three lines, which was most of the
       * reason a row was twice as tall as the text inside it.
       */
      return `
        <tr>
          <td>
            <div class="product-cell">
              ${swatchHtml(p)}
              <div>
                <div class="name">${escapeHtml(p.name)}</div>
                <div class="meta">
                  <span class="sku">${escapeHtml(p.sku)}</span>${meta ? ` · ${meta}` : ''}
                </div>
              </div>
            </div>
          </td>
          <td>${CATEGORY_LABELS[p.category] || escapeHtml(p.category)}</td>
          <td class="num">${formatPrice(p.price)}</td>
          <td>${p.stock.quantity} ${availabilityBadge}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="row-menu">
              <button type="button" class="row-menu-toggle" data-menu-toggle
                      aria-haspopup="menu" aria-expanded="false"
                      aria-label="Actions for ${escapeHtml(p.name)}">⋯</button>
              <div class="row-menu-list" role="menu"
                   aria-label="Actions for ${escapeHtml(p.name)}" hidden>
                <button role="menuitem" data-action="edit" data-id="${p.id}">Edit details</button>
                <button role="menuitem" data-action="stock" data-id="${p.id}">Correct stock</button>
                ${archiveItem}
              </div>
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
    loadProducts();
  })
);

for (const [selector, key] of [
  ['#category-filter', 'category'],
  ['#status-filter', 'status'],
  ['#stock-filter', 'stock'],
]) {
  document.querySelector(selector).addEventListener('change', (event) => {
    state[key] = event.target.value;
    state.page = 1;
    loadProducts();
  });
}

/* ---------- Create / edit modal ---------- */

function openProductModal(product = null) {
  clearFieldErrors(productForm);
  productForm.reset();
  productForm.productId.value = product ? product.id : '';

  document.querySelector('#product-modal-title').textContent = product
    ? 'Edit Product'
    : 'Add Product';
  // SKU is immutable once assigned. Quantity is not on this form at all any
  // more: stock arrives by receiving a purchase order, which is the only
  // place a number can be traced back to a supplier and a delivery.
  productForm.sku.disabled = Boolean(product);
  document.querySelector('#new-product-stock-hint').hidden = Boolean(product);
  document.querySelector('#edit-stock-hint').hidden = !product;

  if (product) {
    productForm.name.value = product.name;
    productForm.sku.value = product.sku;
    productForm.category.value = product.category;
    productForm.finish.value = product.finish || '';
    productForm.size.value = product.size || '';
    productForm.elements['color.name'].value = product.color?.name || '';
    productForm.elements['color.hex'].value = product.color?.hex || '#e2e8f0';
    productForm.price.value = product.price;
    productForm.elements['stock.lowStockThreshold'].value = product.stock.lowStockThreshold;
    productForm.description.value = product.description || '';
  }

  productModal.open();
}

document.querySelector('#add-product-btn').addEventListener('click', () => openProductModal());

productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(productForm);
  const saveButton = document.querySelector('#product-save-btn');
  setBusy(saveButton, true, 'Saving…');

  const productId = productForm.productId.value;
  const body = {
    name: productForm.name.value,
    category: productForm.category.value,
    finish: productForm.finish.value,
    size: productForm.size.value,
    color: {
      name: productForm.elements['color.name'].value,
      hex: productForm.elements['color.hex'].value,
    },
    price: parseFloat(productForm.price.value),
    description: productForm.description.value,
    stock: {
      lowStockThreshold: parseInt(productForm.elements['stock.lowStockThreshold'].value, 10) || 0,
    },
  };

  if (!productId && productForm.sku.value.trim()) {
    body.sku = productForm.sku.value.trim();
  }

  try {
    const result = productId
      ? await api(`/api/products/${productId}`, { method: 'PATCH', body })
      : await api('/api/products', { method: 'POST', body });
    showToast(result.message, 'success');
    productModal.close();
    loadProducts();
  } catch (error) {
    if (error.errors) showFieldErrors(productForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

/* ---------- Stock modal ---------- */

async function openStockModal(product) {
  clearFieldErrors(stockForm);
  stockForm.reset();
  stockProductId = product.id;

  document.querySelector('#stock-product-name').textContent = product.name;
  document.querySelector('#stock-current-qty').textContent = product.stock.quantity;

  stockModal.open();
  loadMovements(product.id);
}

async function loadMovements(productId) {
  const list = document.querySelector('#movements-list');
  list.innerHTML = '<li>Loading…</li>';
  try {
    const { data } = await api(`/api/products/${productId}/movements?limit=5`);
    if (data.movements.length === 0) {
      list.innerHTML = '<li>No stock activity yet.</li>';
      return;
    }
    list.innerHTML = data.movements
      .map((m) => {
        const sign = m.quantity > 0 ? '+' : '';
        const who = m.performedBy ? escapeHtml(m.performedBy.fullName) : 'System';
        const reason = m.reason ? ` — “${escapeHtml(m.reason)}”` : '';
        return `<li><strong>${sign}${m.quantity}</strong> ${m.type} → ${m.quantityAfter} on hand
          · ${formatDate(m.createdAt)} · ${who}${reason}</li>`;
      })
      .join('');
  } catch {
    list.innerHTML = '<li>Could not load stock activity.</li>';
  }
}

stockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(stockForm);
  const applyButton = document.querySelector('#stock-save-btn');
  setBusy(applyButton, true, 'Applying…');

  try {
    const { message, data } = await api(`/api/products/${stockProductId}/stock`, {
      method: 'POST',
      // No type: the endpoint only records corrections now, and deciding
      // that server-side means the client cannot ask for anything else.
      body: {
        quantity: parseInt(stockForm.quantity.value, 10),
        reason: stockForm.reason.value,
      },
    });
    showToast(message, 'success');
    document.querySelector('#stock-current-qty').textContent = data.product.stock.quantity;
    stockForm.quantity.value = '';
    stockForm.reason.value = '';
    loadMovements(stockProductId);
    loadProducts();
  } catch (error) {
    if (error.errors) showFieldErrors(stockForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(applyButton, false);
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
    loadProducts();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    confirmAction = null;
    confirmModal.close();
  }
});

/* ---------- Table actions (event delegation) ---------- */

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const product = productsCache.get(button.dataset.id);
  if (!product) return;

  switch (button.dataset.action) {
    case 'edit':
      openProductModal(product);
      break;
    case 'stock':
      openStockModal(product);
      break;
    case 'archive':
      openConfirm(
        `Archive “${product.name}”? Customers will no longer see it, but its history is kept and it can be restored.`,
        'Archive',
        'btn-danger',
        () => api(`/api/products/${product.id}`, { method: 'DELETE' })
      );
      break;
    case 'restore':
      openConfirm(
        `Restore “${product.name}” to the active catalog?`,
        'Restore',
        'btn-primary',
        () => api(`/api/products/${product.id}`, { method: 'PATCH', body: { isActive: true } })
      );
      break;
  }
});

// Honour deep links like ?stock=low from the dashboard's Stock Alerts tile.
// Runs after the category options are filled so those values validate too.
Object.assign(
  state,
  applyUrlFilters({
    stock: '#stock-filter',
    category: '#category-filter',
    status: '#status-filter',
  })
);
loadProducts();
