/**
 * Procurement vocabulary: how stock gets *into* the shop.
 *
 * The sales side has orders; this is its mirror. A purchase order is raised
 * against a supplier, and only when the delivery actually arrives does any
 * stock move — receiving is the event, not ordering.
 */

const PO_STATUS = Object.freeze({
  DRAFT: 'draft', // being built, nothing committed
  ORDERED: 'ordered', // sent to the supplier, awaiting delivery
  RECEIVED: 'received', // delivered and booked into stock
  CANCELLED: 'cancelled', // abandoned before delivery
});

const PO_STATUS_VALUES = Object.freeze(Object.values(PO_STATUS));

const PO_STATUS_LABELS = Object.freeze({
  [PO_STATUS.DRAFT]: 'Draft',
  [PO_STATUS.ORDERED]: 'Ordered',
  [PO_STATUS.RECEIVED]: 'Received',
  [PO_STATUS.CANCELLED]: 'Cancelled',
});

/**
 * A PO can only be received or cancelled while it is still open. Once
 * received, its stock movements exist and cannot be quietly undone — a
 * mistaken delivery is corrected with a stock adjustment, which leaves its
 * own audit trail rather than rewriting this one.
 */
const OPEN_PO_STATUSES = Object.freeze([PO_STATUS.DRAFT, PO_STATUS.ORDERED]);

module.exports = { PO_STATUS, PO_STATUS_VALUES, PO_STATUS_LABELS, OPEN_PO_STATUSES };
