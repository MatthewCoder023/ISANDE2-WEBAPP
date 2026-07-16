/** Cashier dashboard extras: today's sales and order queue counts. */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';

async function loadStats() {
  const clearSkeleton = statSkeleton();
  try {
    const { data } = await api('/api/orders/stats');
    const { salesToday, awaitingVerification, readyOrders, transactionsToday } = data.stats;

    const set = (key, value) => {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    };

    set('salesToday', formatPrice(salesToday));
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
