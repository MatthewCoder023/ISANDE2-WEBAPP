/**
 * Admin-only dashboard extras: fills stat cards that have live data.
 * Runs alongside the shared dashboard.js bootstrap.
 */
import { api } from '/js/api.js';
import { formatPrice } from '/js/format.js';
import { statSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';
import { deltaMarkup, setMeta } from '/js/trend.js';
import {
  mount,
  pipeline,
  weeklyRevenue,
  inventoryAlerts,
  recentOrders,
} from '/js/widgets.js';

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

    // The same payload feeds the pipeline panel — one request, two readings
    // of it, so the tiles and the pipeline can never disagree.
    mount('[data-widget="pipeline"]', () => pipeline(data.stats));
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

/** Widgets that need their own request. Each panel fails on its own. */
function loadWidgets() {
  mount('[data-widget="revenue"]', async () => {
    const { data } = await api('/api/reports/sales?days=7');
    return weeklyRevenue(data.revenueByDay, data.since, data.days);
  });

  mount('[data-widget="alerts"]', async () => {
    // A wide page, because inventoryAlerts ranks by how close to empty each
    // paint is and the API cannot sort on that.
    const { data } = await api('/api/products?stock=alert&limit=50&sort=name');
    return inventoryAlerts(data.products, '/admin/products');
  });

  mount('[data-widget="recent"]', async () => {
    const { data } = await api('/api/orders?limit=5&sort=newest');
    return recentOrders(data.orders, { viewPath: '/orders' });
  });
}

async function init() {
  const clearSkeleton = statSkeleton();
  // The tiles are what the reader looks at first, so they are awaited; the
  // panels below fill in behind them rather than holding up the count-ups.
  loadWidgets();
  await Promise.allSettled([loadProductStats(), loadOrderStats(), loadUserStats()]);
  clearSkeleton();
}

init();
