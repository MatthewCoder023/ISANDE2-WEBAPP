/**
 * The payment step now lives on the order screen, so one destination covers
 * paying, tracking and the invoice. This page remains only to keep links
 * already out in the world — emails, bookmarks — working.
 */
const orderId = new URLSearchParams(window.location.search).get('order');

window.location.replace(orderId ? `/client/track?order=${orderId}` : '/client/orders');
