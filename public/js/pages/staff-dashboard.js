/** Cashier dashboard extras: today's sales, the order queue, and what needs work. */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { mount, pipeline, inventoryAlerts, recentOrders } from '/js/widgets.js';

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

    // Same payload, second reading — the tiles and the pipeline cannot drift.
    mount('[data-widget="pipeline"]', () => pipeline(data.stats));
  } catch {
    // Cards keep their placeholder.
  } finally {
    clearSkeleton();
  }
}

/**
 * A cashier sells from the same shelves the admin manages, so the alerts
 * panel is theirs too — they just cannot restock from it. Its link goes to
 * the catalogue rather than the admin inventory screen, which the server
 * would refuse them.
 */
function loadWidgets() {
  mount('[data-widget="recent"]', async () => {
    const { data } = await api('/api/orders?limit=5&sort=newest');
    return recentOrders(data.orders, { viewPath: '/orders' });
  });

  mount('[data-widget="alerts"]', async () => {
    // A wide page, because inventoryAlerts ranks by how close to empty each
    // paint is and the API cannot sort on that.
    const { data } = await api('/api/products?stock=alert&limit=50&sort=name');
    return inventoryAlerts(data.products, '/pos');
  });
}

loadStats();
loadWidgets();
