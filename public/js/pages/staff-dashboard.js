/** Cashier dashboard extras: today's sales and order queue counts. */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';

async function loadStats() {
  const clearSkeleton = statSkeleton();
  try {
    const { data } = await api('/api/orders/stats');
    const { salesToday, awaitingVerification, readyOrders, transactionsToday } = data.stats;

    const set = (key, value, format) =>
      countUp(document.querySelector(`[data-stat="${key}"]`), value, format);

    set('salesToday', salesToday, formatPrice);
    set('awaitingVerification', awaitingVerification);
    set('readyOrders', readyOrders);
    set('transactionsToday', transactionsToday);
  } catch {
    // Cards keep their placeholder.
  } finally {
    clearSkeleton();
  }
}

loadStats();
