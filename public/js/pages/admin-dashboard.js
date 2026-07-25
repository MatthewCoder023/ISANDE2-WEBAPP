/**
 * Admin-only dashboard extras: fills stat cards that have live data.
 * Runs alongside the shared dashboard.js bootstrap.
 */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';

const set = (key, value, format) =>
  countUp(document.querySelector(`[data-stat="${key}"]`), value, format);

async function loadProductStats() {
  try {
    const { data } = await api('/api/products/stats');
    set('stockAlerts', data.stats.lowStock + data.stats.outOfStock);
  } catch {
    // Card keeps its placeholder.
  }
}

async function loadOrderStats() {
  try {
    const { data } = await api('/api/orders/stats');
    set('revenueThisMonth', data.stats.revenueThisMonth, formatPrice);
    set('totalOrders', data.stats.totalOrders);
  } catch {
    // Cards keep their placeholder.
  }
}

async function loadUserStats() {
  try {
    const { data } = await api('/api/users/stats');
    set('registeredUsers', data.stats.total);
  } catch {
    // Cards keep their placeholder.
  }
}

async function init() {
  const clearSkeleton = statSkeleton();
  await Promise.allSettled([loadProductStats(), loadOrderStats(), loadUserStats()]);
  clearSkeleton();
}

init();
