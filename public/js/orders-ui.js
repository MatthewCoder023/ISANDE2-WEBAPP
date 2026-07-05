/** Shared order-display helpers for customer and staff pages. */
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';

export const STATUS_BADGES = {
  pending_payment: '<span class="badge badge-warning">Pending Payment</span>',
  pending_verification: '<span class="badge badge-info">Pending Verification</span>',
  payment_verified: '<span class="badge badge-success">Payment Verified</span>',
  preparing: '<span class="badge badge-info">Preparing</span>',
  ready: '<span class="badge badge-primary">Ready for Pickup</span>',
  completed: '<span class="badge badge-success">Completed</span>',
  cancelled: '<span class="badge badge-danger">Cancelled</span>',
};

export const PAYMENT_LABELS = {
  cash: 'Cash',
  gcash: 'GCash',
  card: 'Card',
  cash_on_pickup: 'Cash on Pickup',
};

export const TYPE_LABELS = { online: 'Online', walk_in: 'Walk-in' };

/**
 * Builds tracker steps for an order. GCash orders include the
 * verification stages; cash-on-pickup skips straight to preparing.
 * Each step: { label, description, state: 'done'|'current'|'upcoming', at }
 */
export function buildTimeline(order) {
  const historyByStatus = new Map();
  for (const event of order.statusHistory || []) {
    // Keep the LATEST occurrence (proof can be rejected and resubmitted).
    historyByStatus.set(event.status, event);
  }

  const isGcash = order.payment?.method !== 'cash_on_pickup';
  const steps = [
    { key: 'placed', label: 'Order Placed', description: 'We received your order.' },
    ...(isGcash
      ? [
          {
            key: 'pending_verification',
            label: 'Proof of Payment Submitted',
            description: order.payment?.rejectedReason
              ? `Proof rejected: ${order.payment.rejectedReason} — please upload a new one.`
              : 'Pay via GCash and upload your proof of payment.',
          },
          {
            key: 'payment_verified',
            label: 'Payment Verified',
            description: 'Our staff confirmed your payment.',
          },
        ]
      : []),
    {
      key: 'preparing',
      label: 'Preparing Order',
      description: isGcash
        ? 'Your items are being prepared.'
        : 'Your items are being prepared — pay at the counter on pickup.',
    },
    { key: 'ready', label: 'Ready for Pickup', description: 'Come collect it at the store!' },
    { key: 'completed', label: 'Completed', description: 'Order handed over. Thank you!' },
  ];

  if (order.status === 'cancelled') {
    const cancelledEvent = historyByStatus.get('cancelled');
    const done = steps.filter((s) => historyByStatus.has(s.key) || s.key === 'placed');
    return [
      ...done.map((s) => ({
        ...s,
        state: 'done',
        at: s.key === 'placed' ? order.createdAt : historyByStatus.get(s.key)?.at,
      })),
      {
        key: 'cancelled',
        label: 'Cancelled',
        description: cancelledEvent?.note || 'This order was cancelled and stock restored.',
        state: 'cancelled',
        at: cancelledEvent?.at,
      },
    ];
  }

  // Where are we? Everything up to the current status is done.
  const reachedIndex = steps.findIndex((s) => {
    if (order.status === 'pending_payment') return s.key === 'pending_verification';
    if (s.key === 'placed') return false;
    return s.key === order.status;
  });
  const currentIndex = reachedIndex === -1 ? steps.length : reachedIndex;

  return steps.map((step, index) => {
    const at = step.key === 'placed' ? order.createdAt : historyByStatus.get(step.key)?.at;
    if (order.status === 'pending_payment') {
      // Placed is done; the payment step is current; the rest upcoming.
      if (step.key === 'placed') return { ...step, state: 'done', at };
      return { ...step, state: index === currentIndex ? 'current' : 'upcoming', at };
    }
    if (index < currentIndex) return { ...step, state: 'done', at };
    if (index === currentIndex) {
      return { ...step, state: order.status === 'completed' ? 'done' : 'current', at };
    }
    return { ...step, state: 'upcoming', at };
  });
}

/** Renders the order-detail modal body (items, totals, notes, payment). */
export function renderOrderDetail(container, order, transaction) {
  const itemRows = order.items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(item.sku)}</div>
          </td>
          <td>${formatPrice(item.price)}</td>
          <td>× ${item.quantity}</td>
          <td style="text-align: right;">${formatPrice(item.lineTotal)}</td>
        </tr>`
    )
    .join('');

  const methodLabel = transaction
    ? PAYMENT_LABELS[transaction.method]
    : PAYMENT_LABELS[order.payment?.method] || 'Not selected yet';

  const paymentBlock = transaction
    ? `<p style="margin-top: 1rem;">
         <strong>Payment:</strong> ${methodLabel}
         · Tendered ${formatPrice(transaction.amountTendered)}
         · Change ${formatPrice(transaction.change)}
         ${transaction.receivedBy ? `· Received by ${escapeHtml(transaction.receivedBy.fullName)}` : ''}
       </p>`
    : `<p style="margin-top: 1rem;"><strong>Payment:</strong> ${methodLabel}</p>`;

  const notesBlock = order.notes
    ? `<p style="margin-top: 1rem;"><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>`
    : '';

  container.innerHTML = `
    <p style="margin-bottom: 1rem;">
      <strong>${escapeHtml(order.orderNumber)}</strong> ${STATUS_BADGES[order.status] || ''}<br />
      <span class="text-muted" style="font-size: 0.875rem;">
        ${TYPE_LABELS[order.type] || order.type} order · placed ${formatDateTime(order.createdAt)}
        ${order.customerName ? ` · ${escapeHtml(order.customerName)}` : ''}
      </span>
    </p>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Item</th><th>Price</th><th>Qty</th><th style="text-align: right;">Total</th></tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td colspan="3" style="text-align: right;"><strong>Total</strong></td>
            <td style="text-align: right;"><strong>${formatPrice(order.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    ${notesBlock}
    ${paymentBlock}`;
}
