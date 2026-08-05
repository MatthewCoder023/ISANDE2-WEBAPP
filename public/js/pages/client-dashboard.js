/** Customer dashboard extras: live order and custom-mix counts. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { mount, recentOrders } from '/js/widgets.js';

function fill(stats) {
  for (const [key, value] of Object.entries(stats)) {
    countUp(document.querySelector(`[data-stat="${key}"]`), value);
  }
}

async function loadStats() {
  const clearSkeleton = statSkeleton();
  const results = await Promise.allSettled([
    api('/api/orders/stats'),
    api('/api/mixing/stats'),
  ]);
  clearSkeleton();
  for (const result of results) {
    if (result.status === 'fulfilled') fill(result.value.data.stats);
    // Rejected: cards keep their placeholder.
  }
}

/**
 * The customer's own last few orders. The API scopes this list to the
 * signed-in customer, so no filter is needed here — and the customer name
 * is dropped from each row, because on this page every order is theirs.
 */
function loadRecent() {
  mount('[data-widget="recent"]', async () => {
    const { data } = await api('/api/orders?limit=5&sort=newest');
    return recentOrders(data.orders, {
      title: 'Your recent orders',
      viewPath: '/client/orders',
      withCustomer: false,
      // Customers get a page per order — the tracker each row names.
      rowPath: '/client/track?order=',
    });
  });
}

loadStats();
loadRecent();
