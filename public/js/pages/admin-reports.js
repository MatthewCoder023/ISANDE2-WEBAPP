/**
 * Admin reports: sales analytics with an SVG revenue chart plus the
 * current inventory position. The chart is hand-rolled — a bar chart
 * is ~40 lines of SVG, no charting library needed.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDate } from '/js/format.js';
import { PAYMENT_LABELS } from '/js/orders-ui.js';

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

  const width = Math.max(560, series.length * 14);
  const height = 220;
  const paddingBottom = 22;
  const chartHeight = height - paddingBottom - 8;
  const max = Math.max(...series.map((d) => d.revenue), 1);
  const barWidth = width / series.length;

  const bars = series
    .map((d, i) => {
      const barHeight = Math.round((d.revenue / max) * chartHeight);
      const x = (i * barWidth + 1).toFixed(1);
      const y = 8 + chartHeight - barHeight;
      return (
        `<rect class="chart-bar" x="${x}" y="${y}" width="${Math.max(barWidth - 2, 2).toFixed(1)}" height="${Math.max(barHeight, d.revenue > 0 ? 2 : 0)}" rx="1.5">` +
        `<title>${d.key}: ${formatPrice(d.revenue)}</title></rect>`
      );
    })
    .join('');

  // A few sparse x-axis labels.
  const labelEvery = Math.ceil(series.length / 6);
  const labels = series
    .map((d, i) =>
      i % labelEvery === 0
        ? `<text class="chart-label" x="${(i * barWidth + 2).toFixed(1)}" y="${height - 6}">${d.key.slice(5)}</text>`
        : ''
    )
    .join('');

  document.querySelector('#revenue-chart').innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Revenue by day">` +
    `<line class="chart-axis" x1="0" y1="${8 + chartHeight}" x2="${width}" y2="${8 + chartHeight}"/>` +
    bars +
    labels +
    '</svg>';
}

/* ---------- Tables ---------- */

const numCell = (value) => `<td style="text-align: right;"><strong>${formatPrice(value)}</strong></td>`;

function renderSales(data) {
  const { totals, revenueByDay, byMethod, topProducts, byCategory, days, since } = data;

  const kpis = {
    revenue: formatPrice(totals.revenue),
    transactions: totals.transactions,
    averageSale: formatPrice(totals.averageSale),
    newCustomers: totals.newCustomers,
  };
  for (const [key, value] of Object.entries(kpis)) {
    document.querySelector(`[data-kpi="${key}"]`).textContent = value;
  }

  document.querySelector('#chart-subtitle').textContent =
    `${formatDate(since)} to today · hover a bar for the exact amount`;
  renderChart(revenueByDay, days, since);

  document.querySelector('#top-products-tbody').innerHTML =
    topProducts
      .map(
        (p) => `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong><div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(p.sku)}</div></td>
          <td>${p.unitsSold}</td>
          ${numCell(p.revenue)}
        </tr>`
      )
      .join('') || '<tr><td colspan="3" class="text-muted">No completed sales in this period.</td></tr>';

  document.querySelector('#methods-tbody').innerHTML =
    byMethod
      .map(
        (m) => `
        <tr>
          <td>${PAYMENT_LABELS[m._id] || escapeHtml(m._id)}</td>
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
        <td>${p.stock.quantity} ${p.stock.quantity === 0 ? '<span class="badge badge-danger">Out</span>' : '<span class="badge badge-warning">Low</span>'}</td>
        <td>${p.stock.lowStockThreshold}</td>
      </tr>`
    )
    .join('');
}

/* ---------- Load ---------- */

async function loadReports(days) {
  try {
    const [salesRes, inventoryRes] = await Promise.all([
      api(`/api/reports/sales?days=${days}`),
      api('/api/reports/inventory'),
    ]);
    renderSales(salesRes.data);
    renderInventory(inventoryRes.data);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

document.querySelector('#period-select').addEventListener('change', (event) => {
  loadReports(event.target.value);
});

loadReports(30);
