/** Mixer dashboard extras: live production counts. */
import { api } from '/js/api.js';

async function loadStats() {
  try {
    const { data } = await api('/api/mixing/stats');
    for (const [key, value] of Object.entries(data.stats)) {
      const el = document.querySelector(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    }
  } catch {
    // Cards keep their placeholder.
  }
}

loadStats();
