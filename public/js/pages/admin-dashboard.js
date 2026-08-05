/**
 * Admin-only dashboard extras: fills stat cards that have live data.
 * Runs alongside the shared dashboard.js bootstrap.
 */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { deltaMarkup, setMeta } from '/js/trend.js';

const set = (key, value, format) =>
  countUp(document.querySelector(`[data-stat="${key}"]`), value, format);

async function loadProductStats() {
  try {
    const { data } = await api('/api/products/stats');
    const { lowStock, outOfStock } = data.stats;
    set('stockAlerts', lowStock + outOfStock);

    /**
     * Not a trend — a stock alert count has no meaningful "previous period",
     * and inventing one would be the decoration this line replaced. What is
     * worth knowing is how much of the number is already too late to reorder.
     */
    if (outOfStock > 0) {
      setMeta(
        'stockAlerts',
        `<span class="stat-delta is-down">${outOfStock}</span><span>already out of stock</span>`
      );
    } else if (lowStock > 0) {
      setMeta('stockAlerts', '<span>all still in stock, running low</span>');
    }
  } catch {
    // Card keeps its placeholder.
  }
}

async function loadOrderStats() {
  try {
    const { data } = await api('/api/orders/stats');
    set('revenueThisMonth', data.stats.revenueThisMonth, formatPrice);
    set('totalOrders', data.stats.totalOrders);

    setMeta(
      'revenueThisMonth',
      deltaMarkup(
        data.stats.revenueThisMonth,
        data.stats.revenueLastMonthToDate,
        'same point last month'
      )
    );
  } catch {
    // Cards keep their placeholder.
  }
}

async function loadUserStats() {
  try {
    const { data } = await api('/api/users/stats');
    set('registeredUsers', data.stats.total);

    // A plain count of new sign-ups, not a percentage: the total is
    // cumulative, so "up 3%" would say less than "4 joined this month".
    if (data.stats.newThisMonth > 0) {
      setMeta(
        'registeredUsers',
        `<span class="stat-delta is-up">+${data.stats.newThisMonth}</span><span>joined this month</span>`
      );
    }
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
