/**
 * Admin reports: sales analytics with an SVG revenue chart plus the
 * current inventory position. The chart is hand-rolled — a bar chart
 * is ~40 lines of SVG, no charting library needed.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDate } from '/js/format.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';
import { statSkeleton, tableSkeleton } from '/js/skeleton.js';
import { countUp } from '/js/count-up.js';

const CATEGORY_LABELS = {
  interior: 'Interior Paint',
  exterior: 'Exterior Paint',
  primer: 'Primers & Sealers',
  enamel: 'Enamel & Wood/Metal',
  spray: 'Spray Paint',
  supplies: 'Tools & Supplies',
  other: 'Other',
};

/* ---------- Revenue chart ---------- */

/** Rounds up to a 1/2/5 × 10ⁿ ceiling so axis labels look intentional. */
function niceCeil(value) {
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * exponent;
}

const compactPeso = (value) =>
  value >= 1000 ? `₱${(value / 1000).toFixed(value >= 9950 ? 0 : 1)}k` : `₱${value}`;

function renderChart(revenueByDay, days, since) {
  // Fill in zero-revenue days so the x-axis is continuous.
  const byDate = new Map(revenueByDay.map((d) => [d._id, d.revenue]));
  const series = [];
  const start = new Date(since);
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    series.push({ key, revenue: byDate.get(key) || 0 });
  }

  const padLeft = 46;
  const width = padLeft + Math.max(520, series.length * 14);
  const height = 240;
  const padTop = 10;
  const padBottom = 24;
  const chartHeight = height - padTop - padBottom;
  const max = niceCeil(Math.max(...series.map((d) => d.revenue), 1));
  const barWidth = (width - padLeft) / series.length;

  // Horizontal gridlines with peso labels at 0 / ¼ / ½ / ¾ / max.
  const gridSteps = 4;
  const grid = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const value = (max * i) / gridSteps;
    const y = padTop + chartHeight * (1 - i / gridSteps);
    const line = i === 0
      ? `<line class="chart-axis" x1="${padLeft}" y1="${y}" x2="${width}" y2="${y}"/>`
      : `<line class="chart-grid" x1="${padLeft}" y1="${y}" x2="${width}" y2="${y}"/>`;
    return `${line}<text class="chart-label" x="${padLeft - 6}" y="${y + 3}" text-anchor="end">${compactPeso(value)}</text>`;
  }).join('');

  const bars = series
    .map((d, i) => {
      const barHeight = Math.round((d.revenue / max) * chartHeight);
      const x = (padLeft + i * barWidth + 1).toFixed(1);
      const y = padTop + chartHeight - barHeight;
      return (
        `<rect class="chart-bar" x="${x}" y="${y}" width="${Math.max(barWidth - 2, 2).toFixed(1)}"` +
        ` height="${Math.max(barHeight, d.revenue > 0 ? 2 : 0)}" rx="1.5"` +
        ` data-label="${d.key}" data-value="${d.revenue}"></rect>`
      );
    })
    .join('');

  const labelEvery = Math.ceil(series.length / 6);
  const labels = series
    .map((d, i) =>
      i % labelEvery === 0
        ? `<text class="chart-label" x="${(padLeft + i * barWidth + 2).toFixed(1)}" y="${height - 8}">${d.key.slice(5)}</text>`
        : ''
    )
    .join('');

  const chartWrap = document.querySelector('#revenue-chart');
  chartWrap.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue by day">` +
    '<defs><linearGradient id="revenue-gradient" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--primary-500)"/>' +
    '<stop offset="100%" stop-color="var(--violet-600)"/>' +
    '</linearGradient></defs>' +
    grid +
    bars +
    labels +
    '</svg>' +
    '<div class="chart-tooltip" id="chart-tooltip" hidden></div>';

  // Hover tooltip that follows the bars.
  const tooltip = chartWrap.querySelector('#chart-tooltip');
  const svg = chartWrap.querySelector('svg');
  svg.addEventListener('pointermove', (event) => {
    const bar = event.target.closest('.chart-bar');
    if (!bar) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = `${bar.dataset.label} · ${formatPrice(Number(bar.dataset.value))}`;
    const wrapRect = chartWrap.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    tooltip.style.left = `${barRect.left - wrapRect.left + barRect.width / 2 + chartWrap.scrollLeft}px`;
    tooltip.style.top = `${barRect.top - wrapRect.top}px`;
    tooltip.hidden = false;
  });
  svg.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
  });
}

/* ---------- Payment-method donut ---------- */

const METHOD_COLORS = {
  cash: 'var(--success-500)',
  gcash: 'var(--info-500)',
  card: 'var(--violet-600)',
};

function renderDonut(byMethod) {
  const wrap = document.querySelector('#methods-donut');
  const total = byMethod.reduce((sum, m) => sum + m.amount, 0);
  if (total === 0) {
    wrap.innerHTML = '';
    return;
  }

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = byMethod
    .map((m) => {
      const length = (m.amount / total) * circumference;
      const circle =
        `<circle r="${radius}" cx="70" cy="70" fill="none" stroke="${METHOD_COLORS[m._id] || 'var(--text-faint)'}"` +
        ` stroke-width="18" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"` +
        ` stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 70 70)"><title>${m._id}: ${formatPrice(m.amount)}</title></circle>`;
      offset += length;
      return circle;
    })
    .join('');

  wrap.innerHTML =
    '<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Revenue share by payment method">' +
    `<circle class="donut-track" r="${radius}" cx="70" cy="70" fill="none" stroke-width="18"/>` +
    segments +
    `<text x="70" y="67" text-anchor="middle" class="donut-center-value">${compactPeso(total)}</text>` +
    '<text x="70" y="84" text-anchor="middle" class="donut-center-label">total received</text>' +
    '</svg>';
}

/* ---------- Tables ---------- */

const numCell = (value) => `<td style="text-align: right;"><strong>${formatPrice(value)}</strong></td>`;

function renderSales(data) {
  const { totals, revenueByDay, byMethod, topProducts, byCategory, days, since, until } = data;

  const kpis = {
    revenue: [totals.revenue, formatPrice],
    transactions: [totals.transactions],
    averageSale: [totals.averageSale, formatPrice],
    newCustomers: [totals.newCustomers],
  };
  for (const [key, [value, format]] of Object.entries(kpis)) {
    countUp(document.querySelector(`[data-kpi="${key}"]`), value, format);
  }

  // A custom window may well end in the past — don't claim it runs to today.
  document.querySelector('#chart-subtitle').textContent =
    `${formatDate(since)} to ${formatDate(until)} · hover a bar for the exact amount`;
  renderChart(revenueByDay, days, since);

  const topRevenue = Math.max(...topProducts.map((p) => p.revenue), 0);
  document.querySelector('#top-products-tbody').innerHTML =
    topProducts
      .map((p) => {
        // Each row is measured against the best seller and drawn in the
        // paint it actually sold, so the ranking is legible at a glance.
        const share = topRevenue > 0 ? (p.revenue / topRevenue) * 100 : 0;
        const paint = p.colorHex || 'var(--primary-500)';
        return `
        <tr>
          <td>
            <div class="product-cell" style="min-width: 0; gap: 0.625rem;">
              ${
                p.colorHex
                  ? `<span class="swatch swatch-sm" data-finish="${escapeHtml(p.finish || '')}"
                           style="background-color: ${escapeHtml(p.colorHex)}"></span>`
                  : ''
              }
              <div style="min-width: 0;">
                <strong>${escapeHtml(p.name)}</strong>
                <div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(p.sku)}</div>
                <div class="paint-bar"><span style="width: ${share.toFixed(1)}%; background-color: ${escapeHtml(paint)}"></span></div>
              </div>
            </div>
          </td>
          <td>${p.unitsSold}</td>
          ${numCell(p.revenue)}
        </tr>`;
      })
      .join('') || '<tr><td colspan="3" class="text-muted">No completed sales in this period.</td></tr>';

  renderDonut(byMethod);
  document.querySelector('#methods-tbody').innerHTML =
    byMethod
      .map(
        (m) => `
        <tr>
          <td><span class="method-dot" style="background-color: ${METHOD_COLORS[m._id] || 'var(--text-faint)'}"></span>${PAYMENT_LABELS[m._id] || escapeHtml(m._id)}</td>
          <td>${m.count}</td>
          ${numCell(m.amount)}
        </tr>`
      )
      .join('') || '<tr><td colspan="3" class="text-muted">No payments in this period.</td></tr>';

  document.querySelector('#categories-tbody').innerHTML =
    byCategory
      .map(
        (c) => `
        <tr>
          <td>${CATEGORY_LABELS[c._id] || escapeHtml(c._id)}</td>
          <td>${c.unitsSold}</td>
          ${numCell(c.revenue)}
        </tr>`
      )
      .join('') || '<tr><td colspan="3" class="text-muted">No completed sales in this period.</td></tr>';
}

function renderInventory(data) {
  const { byCategory, totals, lowStock } = data;

  document.querySelector('#inventory-totals').textContent =
    `${totals.skus} active products · ${totals.units} units on hand · ${formatPrice(totals.value)} at retail`;

  document.querySelector('#inventory-tbody').innerHTML = byCategory
    .map(
      (c) => `
      <tr>
        <td>${CATEGORY_LABELS[c._id] || escapeHtml(c._id)}</td>
        <td>${c.skus}</td>
        <td>${c.units}</td>
        ${numCell(c.value)}
      </tr>`
    )
    .join('');

  document.querySelector('#low-stock-empty').hidden = lowStock.length > 0;
  document.querySelector('#low-stock-tbody').innerHTML = lowStock
    .map(
      (p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${escapeHtml(p.sku)}</td>
        <td>${p.stock.quantity} ${p.stock.quantity === 0 ? '<span class="badge badge-dot badge-danger">Out</span>' : '<span class="badge badge-dot badge-warning">Low</span>'}</td>
        <td>${p.stock.lowStockThreshold}</td>
      </tr>`
    )
    .join('');
}

/* ---------- Load ---------- */

/** Current window, as query params. Either trailing days or explicit dates. */
let windowParams = new URLSearchParams({ days: '30' });

async function loadReports(params = windowParams) {
  windowParams = params;
  const clearSkeleton = statSkeleton('[data-kpi]');
  tableSkeleton(document.querySelector('#top-products-tbody'), 3, 4);
  tableSkeleton(document.querySelector('#methods-tbody'), 3, 3);
  tableSkeleton(document.querySelector('#categories-tbody'), 3, 4);
  tableSkeleton(document.querySelector('#inventory-tbody'), 4, 4);
  tableSkeleton(document.querySelector('#low-stock-tbody'), 4, 3);

  try {
    const [salesRes, inventoryRes] = await Promise.all([
      api(`/api/reports/sales?${params}`),
      api('/api/reports/inventory'),
    ]);
    renderSales(salesRes.data);
    renderInventory(inventoryRes.data);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    clearSkeleton();
  }
}

const customRange = document.querySelector('#custom-range');

document.querySelector('#period-select').addEventListener('change', (event) => {
  const isCustom = event.target.value === 'custom';
  customRange.hidden = !isCustom;
  // Wait for Apply on a custom range — reloading per keystroke is noise.
  if (!isCustom) loadReports(new URLSearchParams({ days: event.target.value }));
});

document.querySelector('#apply-range').addEventListener('click', () => {
  const from = document.querySelector('#range-from').value;
  const to = document.querySelector('#range-to').value;
  if (!from || !to) {
    showToast('Pick both a start and an end date.', 'warning');
    return;
  }
  if (from > to) {
    showToast('The start date needs to come before the end date.', 'warning');
    return;
  }
  loadReports(new URLSearchParams({ from, to }));
});

// Exports whatever window is on screen, so the file matches the page.
document.querySelector('#export-report').addEventListener('click', () => {
  window.location.assign(`/api/reports/sales/export?${windowParams}`);
});

loadReports();
