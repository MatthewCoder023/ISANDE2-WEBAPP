/** Mixer dashboard extras: live production counts. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';

async function loadStats() {
  const clearSkeleton = statSkeleton();
  try {
    const { data } = await api('/api/mixing/stats');
    for (const [key, value] of Object.entries(data.stats)) {
      countUp(document.querySelector(`[data-stat="${key}"]`), value);
    }
  } catch {
    // Cards keep their placeholder.
  } finally {
    clearSkeleton();
  }
}

loadStats();
