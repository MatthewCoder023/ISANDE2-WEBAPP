/** Mixer dashboard extras: live production counts. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';

async function loadStats() {
  const clearSkeleton = statSkeleton();
  try {
    const { data } = await api('/api/mixing/stats');
    for (const [key, value] of Object.entries(data.stats)) {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    }
  } catch {
    // Cards keep their placeholder.
  } finally {
    clearSkeleton();
  }
}

loadStats();
