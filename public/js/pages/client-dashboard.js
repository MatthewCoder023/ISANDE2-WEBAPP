/** Customer dashboard extras: live order and custom-mix counts. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';

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

loadStats();
