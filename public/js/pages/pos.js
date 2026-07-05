/**
 * Point of Sale for cashier/admin: pick products, take payment,
 * complete a walk-in sale in one step. The sale cart is in-memory —
 * a POS terminal doesn't need cross-session persistence.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, debounce } from '/js/format.js';
import { setBusy } from '/js/form-utils.js';

const saleLines = new Map(); // productId -> { id, name, price, hex, size, quantity, maxQuantity }
const productsCache = new Map();

const productsEl = document.querySelector('#pos-products');
const saleLinesEl = document.querySelector('#sale-lines');
const saleEmptyEl = document.querySelector('#sale-empty');
const totalEl = document.querySelector('#sale-total');
const methodSelect = document.querySelector('#pos-method');
const tenderedGroup = document.querySelector('#tendered-group');
const tenderedInput = document.querySelector('#pos-tendered');
const changeRow = document.querySelector('#change-row');
const changeAmountEl = document.querySelector('#change-amount');
const completeButton = document.querySelector('#complete-sale-btn');

/* ---------- Product picker ---------- */

async function loadProducts(search = '') {
  const params = new URLSearchParams({ limit: 50, status: 'active' });
  if (search) params.set('search', search);

  try {
    const { data } = await api(`/api/products?${params}`);
    renderProducts(data.products);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderProducts(products) {
  productsCache.clear();
  products.forEach((p) => productsCache.set(p.id, p));

  if (products.length === 0) {
    productsEl.innerHTML = '<div class="empty-state" style="padding: 2rem 1rem;"><p>No products found.</p></div>';
    return;
  }

  productsEl.innerHTML = products
    .map((p) => {
      const out = p.stock.quantity <= 0;
      const meta = [p.sku, p.size, p.finish].filter(Boolean).map(escapeHtml).join(' · ');
      return `
        <button type="button" class="pos-product" data-product-id="${p.id}" ${out ? 'disabled' : ''}>
          <span class="swatch" ${p.color?.hex ? `style="background-color: ${escapeHtml(p.color.hex)}"` : ''}>${p.color?.hex ? '' : '🛠️'}</span>
          <span class="pos-product-info">
            <span class="pos-product-name">${escapeHtml(p.name)}</span>
            <span class="pos-product-meta">${meta} · ${out ? 'Out of stock' : `${p.stock.quantity} in stock`}</span>
          </span>
          <span class="pos-product-price">${formatPrice(p.price)}</span>
        </button>`;
    })
    .join('');
}

document.querySelector('#pos-search').addEventListener(
  'input',
  debounce((event) => loadProducts(event.target.value.trim()))
);

productsEl.addEventListener('click', (event) => {
  const button = event.target.closest('.pos-product');
  if (!button) return;
  const product = productsCache.get(button.dataset.productId);
  if (!product) return;

  const line = saleLines.get(product.id);
  if (line) {
    if (line.quantity >= line.maxQuantity) {
      showToast(`Only ${line.maxQuantity} in stock for ${product.name}.`, 'warning');
      return;
    }
    line.quantity += 1;
  } else {
    saleLines.set(product.id, {
      id: product.id,
      name: product.name,
      price: product.price,
      hex: product.color?.hex || '',
      size: product.size || '',
      quantity: 1,
      maxQuantity: product.stock.quantity,
    });
  }
  renderSale();
});

/* ---------- Sale panel ---------- */

const saleTotal = () =>
  [...saleLines.values()].reduce((sum, line) => sum + line.price * line.quantity, 0);

function renderSale() {
  const lines = [...saleLines.values()];
  saleEmptyEl.hidden = lines.length > 0;

  const linesHtml = lines
    .map(
      (line) => `
      <div class="cart-line" data-product-id="${line.id}">
        <span class="swatch" ${line.hex ? `style="background-color: ${escapeHtml(line.hex)}"` : ''}>${line.hex ? '' : '🛠️'}</span>
        <div class="cart-line-info">
          <div class="cart-line-name">${escapeHtml(line.name)}</div>
          <div class="cart-line-price">${formatPrice(line.price)}${line.size ? ` · ${escapeHtml(line.size)}` : ''}</div>
        </div>
        <span class="qty-stepper">
          <button type="button" data-qty-change="-1" aria-label="Decrease quantity">−</button>
          <span class="qty">${line.quantity}</span>
          <button type="button" data-qty-change="1" aria-label="Increase quantity">+</button>
        </span>
        <span class="cart-line-total">${formatPrice(line.price * line.quantity)}</span>
        <button type="button" class="cart-line-remove" data-remove aria-label="Remove item">✕</button>
      </div>`
    )
    .join('');

  saleLinesEl.innerHTML = linesHtml;
  saleLinesEl.appendChild(saleEmptyEl);

  totalEl.textContent = formatPrice(saleTotal());
  completeButton.disabled = lines.length === 0;
  updateChange();
}

saleLinesEl.addEventListener('click', (event) => {
  const lineEl = event.target.closest('.cart-line');
  if (!lineEl) return;
  const line = saleLines.get(lineEl.dataset.productId);
  if (!line) return;

  const stepButton = event.target.closest('[data-qty-change]');
  if (stepButton) {
    const next = line.quantity + Number(stepButton.dataset.qtyChange);
    if (next > line.maxQuantity) {
      showToast(`Only ${line.maxQuantity} in stock for ${line.name}.`, 'warning');
      return;
    }
    if (next <= 0) saleLines.delete(line.id);
    else line.quantity = next;
    renderSale();
    return;
  }

  if (event.target.closest('[data-remove]')) {
    saleLines.delete(line.id);
    renderSale();
  }
});

/* ---------- Payment ---------- */

function updateChange() {
  const isCash = methodSelect.value === 'cash';
  tenderedGroup.hidden = !isCash;

  if (!isCash) {
    changeRow.hidden = true;
    return;
  }

  const tendered = parseFloat(tenderedInput.value);
  const total = saleTotal();
  const valid = !Number.isNaN(tendered) && tendered >= total && total > 0;
  changeRow.hidden = !valid;
  if (valid) changeAmountEl.textContent = formatPrice(tendered - total);
}

methodSelect.addEventListener('change', updateChange);
tenderedInput.addEventListener('input', updateChange);

completeButton.addEventListener('click', async () => {
  const items = [...saleLines.values()].map(({ id, quantity }) => ({ productId: id, quantity }));
  if (items.length === 0) return;

  const method = methodSelect.value;
  const body = {
    items,
    customerName: document.querySelector('#pos-customer').value.trim(),
    payment: { method },
  };
  if (method === 'cash') {
    body.payment.amountTendered = parseFloat(tenderedInput.value);
    if (Number.isNaN(body.payment.amountTendered)) {
      showToast('Enter the amount tendered.', 'error');
      return;
    }
  }

  setBusy(completeButton, true, 'Completing…');

  try {
    const { message, data } = await api('/api/orders/walk-in', { method: 'POST', body });
    const change = data.transaction.change;
    showToast(change > 0 ? `${message} Change: ${formatPrice(change)}` : message, 'success');

    saleLines.clear();
    document.querySelector('#pos-customer').value = '';
    tenderedInput.value = '';
    renderSale();
    loadProducts(document.querySelector('#pos-search').value.trim());
  } catch (error) {
    showToast(error.message, 'error');
    // Stock may have changed under us — refresh the picker.
    loadProducts(document.querySelector('#pos-search').value.trim());
  } finally {
    setBusy(completeButton, false);
    completeButton.disabled = saleLines.size === 0;
  }
});

loadProducts();
renderSale();
