/**
 * Customer catalog browsing + cart. Read paths are already role-shaped
 * by the API (active products only, availability instead of counts).
 * The cart sends only { productId, quantity } — pricing is server-side.
 */
import { api } from '/js/api.js';
import { showToast, flashToast } from '/js/toast.js';
import { formatPrice, escapeHtml, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { setBusy } from '/js/form-utils.js';
import { getCurrentUser } from '/js/session.js';
import { getCart, addItem, setQuantity, clearCart, cartCount, cartTotal } from '/js/cart.js';

const CATEGORY_LABELS = {
  interior: 'Interior Paint',
  exterior: 'Exterior Paint',
  primer: 'Primers & Sealers',
  enamel: 'Enamel & Wood/Metal',
  spray: 'Spray Paint',
  supplies: 'Tools & Supplies',
};

const AVAILABILITY_BADGES = {
  in_stock: '<span class="badge badge-success">In stock</span>',
  low_stock: '<span class="badge badge-warning">Low stock</span>',
  out_of_stock: '<span class="badge badge-danger">Out of stock</span>',
};

const state = { page: 1, search: '', category: '', sort: 'name' };
const productsCache = new Map();
let userId = null;

const grid = document.querySelector('#product-grid');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');
const cartCountEl = document.querySelector('#cart-count');
const cartModal = initModal(document.querySelector('#cart-modal'));

const categoryFilter = document.querySelector('#category-filter');
for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  categoryFilter.appendChild(option);
}

/* ---------- Catalog grid ---------- */

async function loadProducts() {
  const params = new URLSearchParams({ page: state.page, limit: 12, sort: state.sort });
  if (state.search) params.set('search', state.search);
  if (state.category) params.set('category', state.category);

  try {
    const { data } = await api(`/api/products?${params}`);
    renderGrid(data.products);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderGrid(products) {
  productsCache.clear();
  products.forEach((p) => productsCache.set(p.id, p));

  emptyState.hidden = products.length > 0;

  grid.innerHTML = products
    .map((p) => {
      const swatch = p.color?.hex
        ? `<div class="product-swatch" style="background-color: ${escapeHtml(p.color.hex)}"></div>`
        : '<div class="product-swatch">🛠️</div>';
      const meta = [p.color?.name, p.finish, p.size].filter(Boolean).map(escapeHtml).join(' · ');
      const outOfStock = p.availability === 'out_of_stock';

      return `
        <article class="card product-card">
          ${swatch}
          <div class="product-body">
            <span class="badge badge-primary" style="align-self: flex-start;">
              ${CATEGORY_LABELS[p.category] || escapeHtml(p.category)}
            </span>
            <h2 class="product-name">${escapeHtml(p.name)}</h2>
            ${meta ? `<p class="product-meta">${meta}</p>` : ''}
            <div class="product-footer">
              <span class="product-price">${formatPrice(p.price)}</span>
              ${AVAILABILITY_BADGES[p.availability] || ''}
            </div>
            <button class="btn ${outOfStock ? 'btn-outline' : 'btn-primary'} btn-sm"
                    data-add-to-cart="${p.id}" ${outOfStock ? 'disabled' : ''}
                    style="margin-top: 0.625rem;">
              ${outOfStock ? 'Out of Stock' : '🛒 Add to Cart'}
            </button>
          </div>
        </article>`;
    })
    .join('');
}

grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add-to-cart]');
  if (!button || !userId) return;

  const product = productsCache.get(button.dataset.addToCart);
  if (!product) return;

  const cart = addItem(userId, product);
  updateCartBadge(cart);
  showToast(`${product.name} added to cart.`, 'success');
});

/* ---------- Filters ---------- */

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadProducts();
  })
);

categoryFilter.addEventListener('change', (event) => {
  state.category = event.target.value;
  state.page = 1;
  loadProducts();
});

document.querySelector('#sort-select').addEventListener('change', (event) => {
  state.sort = event.target.value;
  state.page = 1;
  loadProducts();
});

/* ---------- Cart modal ---------- */

function updateCartBadge(cart) {
  cartCountEl.textContent = cartCount(cart);
}

function renderCart() {
  const cart = getCart(userId);
  const items = Object.values(cart);
  const itemsEl = document.querySelector('#cart-items');
  const hasItems = items.length > 0;

  document.querySelector('#cart-empty').hidden = hasItems;
  document.querySelector('#cart-notes-group').hidden = !hasItems;
  document.querySelector('#place-order-btn').disabled = !hasItems;
  document.querySelector('#cart-total').textContent = formatPrice(cartTotal(cart));

  itemsEl.innerHTML = items
    .map(
      (item) => `
      <div class="cart-line" data-product-id="${item.id}">
        <span class="swatch" ${item.hex ? `style="background-color: ${escapeHtml(item.hex)}"` : ''}>${item.hex ? '' : '🛠️'}</span>
        <div class="cart-line-info">
          <div class="cart-line-name">${escapeHtml(item.name)}</div>
          <div class="cart-line-price">${formatPrice(item.price)}${item.size ? ` · ${escapeHtml(item.size)}` : ''}</div>
        </div>
        <span class="qty-stepper">
          <button type="button" data-qty-change="-1" aria-label="Decrease quantity">−</button>
          <span class="qty">${item.quantity}</span>
          <button type="button" data-qty-change="1" aria-label="Increase quantity">+</button>
        </span>
        <span class="cart-line-total">${formatPrice(item.price * item.quantity)}</span>
        <button type="button" class="cart-line-remove" data-remove aria-label="Remove item">✕</button>
      </div>`
    )
    .join('');

  updateCartBadge(cart);
}

document.querySelector('#cart-btn').addEventListener('click', () => {
  renderCart();
  cartModal.open();
});

document.querySelector('#cart-items').addEventListener('click', (event) => {
  const line = event.target.closest('.cart-line');
  if (!line) return;
  const productId = line.dataset.productId;
  const cart = getCart(userId);

  const stepButton = event.target.closest('[data-qty-change]');
  if (stepButton) {
    const current = cart[productId]?.quantity || 0;
    setQuantity(userId, productId, current + Number(stepButton.dataset.qtyChange));
    renderCart();
    return;
  }

  if (event.target.closest('[data-remove]')) {
    setQuantity(userId, productId, 0);
    renderCart();
  }
});

document.querySelector('#place-order-btn').addEventListener('click', async () => {
  const cart = getCart(userId);
  const items = Object.values(cart).map(({ id, quantity }) => ({ productId: id, quantity }));
  if (items.length === 0) return;

  const button = document.querySelector('#place-order-btn');
  setBusy(button, true, 'Placing order…');

  try {
    const { message } = await api('/api/orders', {
      method: 'POST',
      body: { items, notes: document.querySelector('#cart-notes').value },
    });
    clearCart(userId);
    flashToast(message, 'success');
    window.location.assign('/client/orders');
  } catch (error) {
    showToast(error.message, 'error');
    setBusy(button, false);
    // Stock may have changed under us — refresh the availability badges.
    loadProducts();
  }
});

/* ---------- Init ---------- */

async function init() {
  const user = await getCurrentUser();
  userId = user.id;
  updateCartBadge(getCart(userId));
  loadProducts();
}

init();
