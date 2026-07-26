/**
 * Customer cart, persisted in localStorage per user id.
 *
 * Prices stored here are display-only snapshots from browsing time —
 * the server re-prices every order from the live catalog and only ever
 * receives { productId, quantity }.
 */
import { api } from '/js/api.js';

const MAX_QTY = 99;

const storageKey = (userId) => `fc_cart_${userId}`;

export function getCart(userId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId))) || {};
  } catch {
    return {};
  }
}

function saveCart(userId, cart) {
  localStorage.setItem(storageKey(userId), JSON.stringify(cart));
}

export function addItem(userId, product, quantity = 1) {
  const cart = getCart(userId);
  const existing = cart[product.id];
  const newQty = Math.min((existing?.quantity || 0) + quantity, MAX_QTY);

  cart[product.id] = {
    id: product.id,
    name: product.name,
    price: product.price,
    hex: product.color?.hex || '',
    finish: product.finish || '', // display only: drives the swatch sheen
    size: product.size || '',
    quantity: newQty,
  };
  saveCart(userId, cart);
  return cart;
}

/** Sets a line's quantity; 0 or less removes the line. */
export function setQuantity(userId, productId, quantity) {
  const cart = getCart(userId);
  if (quantity <= 0) {
    delete cart[productId];
  } else if (cart[productId]) {
    cart[productId].quantity = Math.min(quantity, MAX_QTY);
  }
  saveCart(userId, cart);
  return cart;
}

export function clearCart(userId) {
  localStorage.removeItem(storageKey(userId));
  return {};
}

export const cartCount = (cart) =>
  Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);

export const cartTotal = (cart) =>
  Object.values(cart).reduce((sum, item) => sum + item.price * item.quantity, 0);

/**
 * Re-checks a cart against the live catalogue.
 *
 * Prices and availability here are snapshots from browsing time, and a cart
 * can sit in this browser for days. Rather than letting the customer find
 * out at the final submit, the checkout asks for the current picture: lines
 * that can no longer be bought are reported, and prices are refreshed so the
 * total shown matches what the server will charge.
 *
 * Returns { unavailable: [{ id, name, reason }], repriced: [{ name, from, to }] }.
 */
export async function revalidateCart(userId) {
  const cart = getCart(userId);
  const lines = Object.values(cart);
  const result = { unavailable: [], repriced: [] };
  if (lines.length === 0) return result;

  const checks = await Promise.all(
    lines.map(async (line) => {
      try {
        const { data } = await api(`/api/products/${line.id}`);
        return { line, product: data.product };
      } catch {
        // 404 covers archived products and mixes that are no longer offered.
        return { line, product: null };
      }
    })
  );

  for (const { line, product } of checks) {
    if (!product) {
      result.unavailable.push({ id: line.id, name: line.name, reason: 'no longer available' });
      continue;
    }
    // Customers are given `availability`, never raw stock counts, so the
    // check has to go through that. Exact quantities are only present for
    // staff — cap against them when they happen to be available.
    if (product.availability === 'out_of_stock') {
      result.unavailable.push({ id: line.id, name: line.name, reason: 'out of stock' });
      continue;
    }
    if (product.price !== line.price) {
      result.repriced.push({ name: line.name, from: line.price, to: product.price });
      cart[line.id].price = product.price;
    }
    const known = product.stock?.quantity;
    if (known !== undefined && line.quantity > known) {
      cart[line.id].quantity = known;
    }
  }

  for (const item of result.unavailable) delete cart[item.id];
  if (result.unavailable.length > 0 || result.repriced.length > 0) saveCart(userId, cart);

  return result;
}

/**
 * Collects custom mixes the shop has finished and puts them in the cart.
 *
 * The cart lives in this browser, so the server cannot place anything in it
 * when a mixer completes a job — the client has to come and fetch. Each mix
 * is acknowledged once collected, so if the customer then removes it, it
 * stays removed instead of reappearing on the next page load.
 *
 * Returns the mixes added, or an empty array. Never throws: a page must not
 * break because this convenience failed.
 */
export async function syncReadyMixes(userId) {
  if (!userId) return [];

  try {
    const { data } = await api('/api/mixing/ready');
    const items = data.items || [];
    if (items.length === 0) return [];

    for (const item of items) {
      const available = item.product.stock?.quantity ?? item.quantity;
      addItem(userId, item.product, Math.max(Math.min(item.quantity, available), 1));
    }

    await api('/api/mixing/ready/ack', {
      method: 'POST',
      body: { requestIds: items.map((item) => item.requestId) },
    });

    // Cart UIs on the current page re-render themselves from storage.
    window.dispatchEvent(new CustomEvent('fc:cart-changed'));
    return items;
  } catch {
    return [];
  }
}
