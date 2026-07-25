/**
 * Checkout step 1: review the cart, adjust quantities, place the order.
 * Placing creates a pending_payment order and moves to the payment page.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice } from '/js/format.js';
import { setBusy } from '/js/form-utils.js';
import { getCurrentUser } from '/js/session.js';
import { getCart, setQuantity, clearCart, cartTotal } from '/js/cart.js';
import { icon } from '/js/icons.js';

let userId = null;

const itemsEl = document.querySelector('#checkout-items');
const emptyEl = document.querySelector('#checkout-empty');
const summaryCard = document.querySelector('#summary-card');
const placeButton = document.querySelector('#place-order-btn');

function render() {
  const cart = getCart(userId);
  const items = Object.values(cart);
  const hasItems = items.length > 0;

  emptyEl.hidden = hasItems;
  summaryCard.style.display = hasItems ? '' : 'none';

  itemsEl.innerHTML = items
    .map(
      (item) => `
      <div class="cart-line" data-product-id="${item.id}">
        <span class="swatch" ${item.hex ? `data-finish="${escapeHtml(item.finish || '')}" style="background-color: ${escapeHtml(item.hex)}"` : ''}>${item.hex ? '' : icon('brush', 16)}</span>
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
        <button type="button" class="cart-line-remove" data-remove aria-label="Remove item">×</button>
      </div>`
    )
    .join('');

  const total = formatPrice(cartTotal(cart));
  document.querySelector('#summary-subtotal').textContent = total;
  document.querySelector('#summary-total').textContent = total;
}

itemsEl.addEventListener('click', (event) => {
  const line = event.target.closest('.cart-line');
  if (!line) return;
  const productId = line.dataset.productId;
  const cart = getCart(userId);

  const stepButton = event.target.closest('[data-qty-change]');
  if (stepButton) {
    const current = cart[productId]?.quantity || 0;
    setQuantity(userId, productId, current + Number(stepButton.dataset.qtyChange));
    render();
    return;
  }
  if (event.target.closest('[data-remove]')) {
    setQuantity(userId, productId, 0);
    render();
  }
});

placeButton.addEventListener('click', async () => {
  const cart = getCart(userId);
  const items = Object.values(cart).map(({ id, quantity }) => ({ productId: id, quantity }));
  if (items.length === 0) return;

  setBusy(placeButton, true, 'Placing order…');

  try {
    const { data } = await api('/api/orders', {
      method: 'POST',
      body: { items, notes: document.querySelector('#order-notes').value },
    });
    clearCart(userId);
    window.location.assign(`/client/payment?order=${data.order.id}`);
  } catch (error) {
    showToast(error.message, 'error');
    setBusy(placeButton, false);
  }
});

async function init() {
  const user = await getCurrentUser();
  userId = user.id;
  render();
}

init();
