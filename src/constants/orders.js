/**
 * Central order-domain definitions. Status transitions, payment methods,
 * and order types all derive from these.
 */
const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment', // placed online, awaiting payment / proof
  PENDING_VERIFICATION: 'pending_verification', // proof uploaded, awaiting staff review
  PAYMENT_VERIFIED: 'payment_verified', // staff approved the payment
  PREPARING: 'preparing', // items being prepared
  READY: 'ready', // ready for pickup
  COMPLETED: 'completed', // handed over (and paid)
  CANCELLED: 'cancelled', // stock restored
});

/** Statuses a staff member may cancel from (client: pending_payment only). */
const CANCELLABLE_STATUSES = Object.freeze([
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.PENDING_VERIFICATION,
  ORDER_STATUS.PAYMENT_VERIFIED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
]);

const ORDER_TYPES = Object.freeze({
  ONLINE: 'online', // placed by a customer through checkout
  WALK_IN: 'walk_in', // POS sale, paid immediately
});

/** Methods a transaction can be settled with (POS + verification). */
const PAYMENT_METHODS = Object.freeze(['cash', 'gcash', 'card']);

/** Methods offered on the online checkout payment page. */
const ONLINE_PAYMENT_METHODS = Object.freeze(['gcash', 'cash_on_pickup']);

module.exports = {
  ORDER_STATUS,
  CANCELLABLE_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  ONLINE_PAYMENT_METHODS,
};
