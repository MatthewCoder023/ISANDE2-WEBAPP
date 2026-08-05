/** Mixer dashboard extras: live production counts and the current bench. */
import { api } from '/js/api.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { mount, mixBench } from '/js/widgets.js';

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

/** The jobs themselves, not just how many — this is the day's actual work. */
function loadBench() {
  mount('[data-widget="bench"]', async () => {
    const { data } = await api('/api/mixing/requests?status=active&limit=6');
    return mixBench(data.requests);
  });
}

loadStats();
loadBench();
