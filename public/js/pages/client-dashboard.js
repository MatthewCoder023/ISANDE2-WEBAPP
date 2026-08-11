/** Customer dashboard extras: live order and custom-mix counts. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { getCurrentUser } from '/js/session.js';
import { mount, recentOrders } from '/js/widgets.js';
import { maybeStartClientTour, openClientTour } from '/js/client-tour.js';

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

/**
 * The walkthrough, for a customer who has never been through it — in
 * practice, the first screen after registering. getCurrentUser is the same
 * memoized lookup the shell already made, so this costs no extra request.
 */
async function setupTour() {
  document
    .querySelector('[data-tour-replay]')
    ?.addEventListener('click', () => openClientTour());

  try {
    maybeStartClientTour(await getCurrentUser());
  } catch {
    // No session: the shell is already redirecting to the login page.
  }
}

loadStats();
loadRecent();
setupTour();
