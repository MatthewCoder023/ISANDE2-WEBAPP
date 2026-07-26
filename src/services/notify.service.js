const User = require('../models/User');
const { sendMail } = require('./mail.service');
const { notifyUser, notifyRoles } = require('./notification.service');
const { ROLES } = require('../constants/roles');

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
      `\n\nPlease upload a new proof (or choose cash on pickup): ${APP_URL}/client/track?order=${order.id}\n\n` +
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

/**
 * A hand-mixed paint is finished and has been published for sale. Sent once,
 * when the mixer completes the job.
 */
async function notifyMixReady(request, product) {
  try {
    if (!request.customer) return;

    const customer = await User.findById(request.customer);
    if (!customer) return;

    await notifyUser(request.customer, {
      type: 'mix_ready',
      title: `Your custom mix ${request.requestNumber} is ready`,
      body: "It's in your cart — check out whenever you like.",
      link: '/client/products',
    });

    const total = (product.price * (request.quantity || 1)).toFixed(2);
    await sendMail({
      to: customer.email,
      subject: `Your custom mix is ready — ${request.requestNumber}`,
      text:
        `Hi ${customer.firstName},\n\n` +
        `We've finished mixing "${product.color?.name || request.targetColor.hex}" ` +
        `(${request.targetColor.hex}) for request ${request.requestNumber}.\n\n` +
        `${request.quantity || 1} × ₱${product.price.toFixed(2)} = ₱${total}\n\n` +
        `We've placed it in your cart — check out whenever you're ready: ` +
        `${APP_URL}/client/products\n\n` +
        `— Flavor & Color`,
    });
  } catch (err) {
    console.error('Mix-ready notification failed:', err.message);
  }
}

/** Short in-app wording for the same events the emails above cover. */
const IN_APP = {
  payment_verified: (order) => ({
    title: `Payment confirmed for ${order.orderNumber}`,
    body: "We're preparing your order now.",
  }),
  payment_rejected: (order) => ({
    title: `Payment proof needs another look`,
    body:
      `We couldn't verify the proof for ${order.orderNumber}.` +
      (order.payment?.rejectedReason ? ` ${order.payment.rejectedReason}.` : ''),
  }),
  ready: (order) => ({
    title: `${order.orderNumber} is ready for pickup`,
    body: 'Drop by the store whenever suits you.',
  }),
  auto_cancelled: (order) => ({
    title: `${order.orderNumber} was cancelled`,
    body: 'Payment was not received in time, so the items went back on the shelf.',
  }),
};

async function notifyOrderEvent(order, event) {
  try {
    const template = TEMPLATES[event];
    if (!template || !order.customer) return;

    const customer = await User.findById(order.customer);
    if (!customer) return;

    await sendMail({ to: customer.email, ...template(order, customer.firstName) });

    // Email reaches people who are away; this reaches whoever is looking.
    const inApp = IN_APP[event];
    if (inApp) {
      await notifyUser(order.customer, {
        type: `order_${event}`,
        link: `/client/track?order=${order.id}`,
        ...inApp(order),
      });
    }
  } catch (err) {
    // Notifications must never break the flow that triggered them.
    console.error(`Order notification "${event}" failed:`, err.message);
  }
}

/**
 * Work arriving on a staff desk. There is no email for these — staff are
 * in the app, and a queue that fills up silently is the actual problem.
 */
async function notifyStaffProofUploaded(order) {
  await notifyRoles([ROLES.CASHIER, ROLES.ADMIN], {
    type: 'proof_uploaded',
    title: `Payment proof to verify — ${order.orderNumber}`,
    body: `${order.customerName || 'A customer'} uploaded proof for review.`,
    link: `/orders?status=pending_verification`,
  });
}

async function notifyStaffMixRequested(request) {
  await notifyRoles([ROLES.PAINT_MIXER, ROLES.ADMIN], {
    type: 'mix_requested',
    title: `New custom mix — ${request.requestNumber}`,
    body: `${request.targetColor?.name || request.targetColor.hex}, ${request.quantity} unit(s).`,
    link: '/mixing?status=queued',
  });
}

module.exports = {
  notifyOrderEvent,
  notifyMixReady,
  notifyStaffProofUploaded,
  notifyStaffMixRequested,
};
