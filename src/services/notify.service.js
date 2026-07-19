const User = require('../models/User');
const { sendMail } = require('./mail.service');

/**
 * Customer-facing order notifications. Called (fire-and-forget) from
 * order.service at the transitions a customer actually cares about;
 * walk-in sales have no customer account and are skipped silently.
 */

const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

const trackLink = (order) => `${APP_URL}/client/track?order=${order.id}`;

const TEMPLATES = {
  payment_verified: (order, name) => ({
    subject: `Payment confirmed — ${order.orderNumber}`,
    text:
      `Hi ${name},\n\n` +
      `We've verified your GCash payment of ₱${order.total.toFixed(2)} for order ${order.orderNumber}. ` +
      `We're getting it ready now.\n\n` +
      `Track your order: ${trackLink(order)}\n\n` +
      `— Flavor & Color`,
  }),
  payment_rejected: (order, name) => ({
    subject: `Action needed — payment proof for ${order.orderNumber}`,
    text:
      `Hi ${name},\n\n` +
      `We couldn't verify the payment proof for order ${order.orderNumber}.` +
      (order.payment.rejectedReason ? ` Reason: ${order.payment.rejectedReason}.` : '') +
      `\n\nPlease upload a new proof (or choose cash on pickup): ${APP_URL}/client/payment?order=${order.id}\n\n` +
      `— Flavor & Color`,
  }),
  ready: (order, name) => ({
    subject: `Ready for pickup — ${order.orderNumber}`,
    text:
      `Hi ${name},\n\n` +
      `Your order ${order.orderNumber} is ready! Drop by the store to pick it up — ` +
      `please bring this order number.\n\n` +
      `Flavor & Color, Mindanao Ave. cor. Arty 2, Quezon City\n\n` +
      `Track your order: ${trackLink(order)}\n\n` +
      `— Flavor & Color`,
  }),
  auto_cancelled: (order, name) => ({
    subject: `Order ${order.orderNumber} was cancelled`,
    text:
      `Hi ${name},\n\n` +
      `We didn't receive payment for order ${order.orderNumber}, so it has been cancelled ` +
      `and the items were returned to stock. If you still want them, you can place a new ` +
      `order any time: ${APP_URL}/client/products\n\n` +
      `— Flavor & Color`,
  }),
};

async function notifyOrderEvent(order, event) {
  try {
    const template = TEMPLATES[event];
    if (!template || !order.customer) return;

    const customer = await User.findById(order.customer);
    if (!customer) return;

    await sendMail({ to: customer.email, ...template(order, customer.firstName) });
  } catch (err) {
    // Notifications must never break the flow that triggered them.
    console.error(`Order notification "${event}" failed:`, err.message);
  }
}

module.exports = { notifyOrderEvent };
