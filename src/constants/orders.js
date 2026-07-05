/**
 * Central order-domain definitions. Status transitions, payment methods,
 * and order types all derive from these.
 */
const ORDER_STATUS = Object.freeze({
  PENDING: 'pending', // placed online, awaiting preparation
  READY: 'ready', // prepared, awaiting pickup & payment
  COMPLETED: 'completed', // paid and handed over
  CANCELLED: 'cancelled', // stock restored
});

const ORDER_TYPES = Object.freeze({
  ONLINE: 'online', // placed by a customer, paid on pickup
  WALK_IN: 'walk_in', // POS sale, paid immediately
});

const PAYMENT_METHODS = Object.freeze(['cash', 'gcash', 'card']);

module.exports = { ORDER_STATUS, ORDER_TYPES, PAYMENT_METHODS };
