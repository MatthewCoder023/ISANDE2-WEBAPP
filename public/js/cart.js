/**
 * Customer cart, persisted in localStorage per user id.
 *
 * Prices stored here are display-only snapshots from browsing time —
 * the server re-prices every order from the live catalog and only ever
 * receives { productId, quantity }.
 */
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
