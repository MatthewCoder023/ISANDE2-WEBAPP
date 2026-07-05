/** Shared order-display helpers for customer and staff pages. */
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';

export const STATUS_BADGES = {
  pending: '<span class="badge badge-warning">Pending</span>',
  ready: '<span class="badge badge-info">Ready</span>',
  completed: '<span class="badge badge-success">Completed</span>',
  cancelled: '<span class="badge badge-danger">Cancelled</span>',
};

export const PAYMENT_LABELS = { cash: 'Cash', gcash: 'GCash', card: 'Card' };

export const TYPE_LABELS = { online: 'Online', walk_in: 'Walk-in' };

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

  const paymentBlock = transaction
    ? `<p style="margin-top: 1rem;">
         <strong>Payment:</strong> ${PAYMENT_LABELS[transaction.method] || transaction.method}
         · Tendered ${formatPrice(transaction.amountTendered)}
         · Change ${formatPrice(transaction.change)}
         ${transaction.receivedBy ? `· Received by ${escapeHtml(transaction.receivedBy.fullName)}` : ''}
       </p>`
    : '';

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
