/**
 * Dashboard widgets.
 *
 * The KPI row says how the business is doing. These say what needs someone
 * now: which orders are stuck, which paints are about to run out, what has
 * happened in the last few hours. Every one of them reads from an endpoint
 * the page could already call — nothing here asks the server for anything
 * new, and nothing here can show a role something it could not already see,
 * because the API scopes each list by the caller's own role.
 *
 * Every row is a link into the screen where the work is done. A dashboard
 * that can only be read is a poster.
 */
import { icon } from '/js/icons.js';
import { escapeHtml, formatPrice } from '/js/format.js';

/* ---------- Shared chrome ---------- */

/** Panel header: title with its glyph, and an optional link out. */
export function widgetHead(title, iconName, link) {
  const out = link
    ? `<a class="widget-link" href="${link.href}">${escapeHtml(link.label)}${icon('chevron-right', 14)}</a>`
    : '';
  return (
    `<div class="widget-head"><h3 class="widget-title">${icon(iconName, 16)}` +
    `${escapeHtml(title)}</h3>${out}</div>`
  );
}

/** Nothing to show, and that is good news — an all-clear. */
const empty = (message) =>
  `<p class="widget-empty">${icon('check-circle', 15)}${escapeHtml(message)}</p>`;

/** Nothing to show, and that is not good news. A tick here read as success. */
const failed = (message) =>
  `<p class="widget-empty is-error">${icon('alert-triangle', 15)}${escapeHtml(message)}</p>`;

/**
 * Nothing to show, and it is neither. "Nothing on order" is only good news
 * if nothing is running low — and the panel that answers *that* sits right
 * beside this one, so a tick here would be the dashboard congratulating
 * itself on a question it has not asked.
 */
const note = (message) =>
  `<p class="widget-empty">${icon('info', 15)}${escapeHtml(message)}</p>`;

/**
 * Widgets fail quietly and separately. One endpoint being slow or down
 * should cost its own panel, never the dashboard — so each render is
 * wrapped and a failure leaves a plain line rather than a broken layout.
 */
export async function mount(selector, build) {
  const host = document.querySelector(selector);
  if (!host) return;
  try {
    host.innerHTML = await build();
  } catch {
    host.innerHTML = failed('Could not load this just now.');
  }
}

/* ---------- Relative time ---------- */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now" / "12m" / "3h" / "5d" — short enough to sit in a table trail. */
export function shortAgo(value) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------- Pipeline ---------- */

/**
 * Where the open orders are sitting. Built from the stats the dashboard has
 * already fetched, so it costs no extra request — and each stage links to
 * the orders table filtered to exactly the set it counts, which is the
 * whole point of showing the number.
 */
export function pipeline(stats, basePath = '/orders') {
  const stages = [
    {
      tone: 'warning',
      name: 'Awaiting verification',
      count: stats.awaitingVerification,
      href: `${basePath}?status=pending_verification`,
    },
    {
      tone: 'info',
      name: 'Preparing',
      count: stats.preparingOrders,
      href: `${basePath}?status=preparing`,
    },
    {
      tone: 'success',
      name: 'Ready for pickup',
      count: stats.readyOrders,
      href: `${basePath}?status=ready`,
    },
    // No "Completed" stage: the stats payload carries no completed count, so
    // it rendered a permanent em-dash next to three live figures and read as
    // a panel that had half failed. The pipeline is about work still open;
    // finished orders are one click away in the header link.
  ];

  const body = stages
    .map(
      (stage) =>
        `<a class="pipeline-stage" data-tone="${stage.tone}" href="${stage.href}">` +
        `<span class="pipeline-count">${stage.count ?? 0}</span>` +
        `<span class="pipeline-name">${escapeHtml(stage.name)}</span></a>`
    )
    .join('');

  return (
    widgetHead('Order pipeline', 'activity', { label: 'All orders', href: basePath }) +
    `<div class="pipeline">${body}</div>`
  );
}

/* ---------- Weekly revenue ---------- */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dateKey = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

/**
 * Seven bars, one per day, ending today.
 *
 * The API only returns days that had a transaction, so the series is filled
 * in here — a week with a quiet Tuesday must still show seven columns, or
 * the shape of the week is a lie.
 *
 * Bars are scaled against the best day in the window rather than a fixed
 * ceiling, so the chart is about the shape of the week, not its magnitude;
 * the total underneath carries the magnitude.
 */
export function weeklyRevenue(revenueByDay, since, days = 7) {
  const byDate = new Map(revenueByDay.map((entry) => [entry._id, entry.revenue]));
  const start = new Date(since);
  const today = dateKey(new Date());

  const series = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = dateKey(date);
    series.push({ key, day: DAY_NAMES[date.getDay()], revenue: byDate.get(key) || 0 });
  }

  const peak = Math.max(...series.map((d) => d.revenue), 1);
  const total = series.reduce((sum, d) => sum + d.revenue, 0);
  const best = series.reduce((a, b) => (b.revenue > a.revenue ? b : a));

  const bars = series
    .map((entry, i) => {
      // A day with no sales still gets a sliver, so the column reads as an
      // empty day rather than a missing one.
      const height = entry.revenue > 0 ? Math.max((entry.revenue / peak) * 100, 6) : 2;
      const isToday = entry.key === today ? ' data-today' : '';
      const title = `${entry.day} — ${formatPrice(entry.revenue)}`;
      return (
        `<div class="spark-col"${isToday} title="${escapeHtml(title)}">` +
        `<div class="spark-bar" style="height: ${height}%; animation-delay: ${i * 40}ms"></div>` +
        `<span class="spark-day">${entry.day}</span></div>`
      );
    })
    .join('');

  const summary =
    total > 0
      ? `<small>best day ${escapeHtml(best.day)}, ${escapeHtml(formatPrice(best.revenue))}</small>`
      : '<small>no sales in this window</small>';

  return (
    widgetHead('Revenue this week', 'trending-up', {
      label: 'Full report',
      href: '/admin/reports?days=7',
    }) +
    `<div class="spark-total">${escapeHtml(formatPrice(total))}${summary}</div>` +
    `<div class="spark">${bars}</div>`
  );
}

/* ---------- Inventory alerts ---------- */

/**
 * Paints at or below their reorder threshold, worst first.
 *
 * The ordering is done here because the products API sorts by name, price or
 * date — not by how close to empty something is. Taking the first five of a
 * name-sorted page meant an out-of-stock paint late in the alphabet simply
 * never appeared, which defeats the panel. Callers fetch a wide page; this
 * ranks it and keeps the top few.
 *
 * The bar shows how much of the threshold is left — the useful proportion
 * when deciding what to reorder, since a threshold of 5 and one of 40 mean
 * very different things about the same "3 left".
 */
export function inventoryAlerts(allProducts, viewPath, limit = 5) {
  const severity = (product) => {
    const quantity = product.stock?.quantity ?? 0;
    const threshold = Math.max(product.stock?.lowStockThreshold ?? 0, 1);
    return quantity / threshold;
  };
  const products = [...allProducts].sort((a, b) => severity(a) - severity(b)).slice(0, limit);

  if (products.length === 0) {
    return (
      widgetHead('Inventory alerts', 'boxes', { label: 'Inventory', href: viewPath }) +
      empty('Every paint is above its reorder level.')
    );
  }

  const rows = products
    .map((product) => {
      const quantity = product.stock?.quantity ?? 0;
      const threshold = Math.max(product.stock?.lowStockThreshold ?? 0, 1);
      const filled = Math.min(Math.round((quantity / threshold) * 100), 100);
      const out = quantity === 0;
      return (
        `<a class="mini-row" href="${viewPath}?stock=${out ? 'out' : 'low'}">` +
        `<span class="mini-main"><span class="mini-name">${escapeHtml(product.name)}</span>` +
        `<span class="mini-meta${out ? ' is-critical' : ''}">` +
        `${out ? 'Out of stock' : `${quantity} left of ${threshold}`}` +
        `</span></span>` +
        `<span class="stock-bar"${out ? ' data-empty' : ''}><span style="width: ${filled}%"></span></span>` +
        '</a>'
      );
    })
    .join('');

  return (
    widgetHead('Inventory alerts', 'boxes', { label: 'Inventory', href: viewPath }) +
    `<div class="mini-list">${rows}</div>`
  );
}

/* ---------- Incoming stock ---------- */

/** "tomorrow" / "in 4 days" / "overdue" — a date is less use than a distance. */
function dueIn(value) {
  if (!value) return 'no date given';

  const days = Math.round((new Date(value) - Date.now()) / DAY);
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}

/**
 * What is already on its way, read against the alerts panel beside it.
 *
 * Aggregated by product rather than listed per order, because the question
 * this answers is "is more of *this paint* coming?" — and one paint can sit
 * on two open orders. Soonest first: what lands next is what decides whether
 * a low stock line needs acting on today.
 *
 * Quantities are the ordered figures, which is all an open order knows.
 * Nothing here has arrived yet, and none of it has touched stock.
 */
export function incomingStock(purchaseOrders, viewPath = '/admin/purchase-orders', limit = 5) {
  const head = widgetHead('Incoming stock', 'truck', {
    label: 'Purchase orders',
    href: viewPath,
  });

  const byProduct = new Map();
  for (const po of purchaseOrders) {
    for (const item of po.items || []) {
      const existing = byProduct.get(item.sku);
      if (existing) {
        existing.quantity += item.quantityOrdered;
        // Two orders for one paint: the earlier arrival is the one that
        // answers "when does this stop being a problem".
        if (!existing.expectedDate || (po.expectedDate && po.expectedDate < existing.expectedDate)) {
          existing.expectedDate = po.expectedDate;
          existing.supplierName = po.supplierName;
        }
        existing.orders += 1;
      } else {
        byProduct.set(item.sku, {
          name: item.name,
          sku: item.sku,
          quantity: item.quantityOrdered,
          supplierName: po.supplierName,
          expectedDate: po.expectedDate,
          orders: 1,
        });
      }
    }
  }

  if (byProduct.size === 0) return head + note('Nothing on order.');

  // Dated deliveries first and soonest at the top; undated ones fall to the
  // bottom rather than pretending to be imminent.
  const lines = [...byProduct.values()]
    .sort((a, b) => {
      if (!a.expectedDate && !b.expectedDate) return b.quantity - a.quantity;
      if (!a.expectedDate) return 1;
      if (!b.expectedDate) return -1;
      return new Date(a.expectedDate) - new Date(b.expectedDate);
    })
    .slice(0, limit);

  const rows = lines
    .map((line) => {
      const from =
        line.orders > 1
          ? `${line.orders} orders · ${dueIn(line.expectedDate)}`
          : `${line.supplierName} · ${dueIn(line.expectedDate)}`;
      const late = line.expectedDate && new Date(line.expectedDate) < Date.now();

      return (
        `<a class="mini-row" href="${viewPath}?status=open">` +
        `<span class="mini-main"><span class="mini-name">${escapeHtml(line.name)}</span>` +
        `<span class="mini-meta${late ? ' is-critical' : ''}">${escapeHtml(from)}</span></span>` +
        `<span class="mini-trail"><span class="mini-amount">+${line.quantity}</span>` +
        '<span class="mini-time">on order</span></span>' +
        '</a>'
      );
    })
    .join('');

  return head + `<div class="mini-list">${rows}</div>`;
}

/* ---------- Recent activity ---------- */

const STATUS_TONE = {
  pending_payment: 'warning',
  pending_verification: 'warning',
  payment_verified: 'info',
  preparing: 'info',
  ready: 'success',
  completed: 'success',
  cancelled: 'danger',
};

const STATUS_TEXT = {
  pending_payment: 'Pending payment',
  pending_verification: 'Awaiting verification',
  payment_verified: 'Payment verified',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * The last few orders, newest first.
 *
 * `withCustomer` is off for the customer's own dashboard, where every order
 * is theirs and the name is just noise. `rowPath` is how a row addresses one
 * order: customers have a page per order, staff work them from the list, so
 * without it every row pointed at the same place and the order number in the
 * row was decoration.
 */
export function recentOrders(
  orders,
  { title = 'Recent activity', viewPath, withCustomer = true, rowPath = null }
) {
  if (orders.length === 0) {
    return (
      widgetHead(title, 'clock', { label: 'View all', href: viewPath }) +
      empty('Nothing here yet.')
    );
  }

  const rows = orders
    .map((order) => {
      const tone = STATUS_TONE[order.status] || 'info';
      const status = STATUS_TEXT[order.status] || order.status;
      const who = withCustomer && order.customerName ? `${order.customerName} · ` : '';
      const href = rowPath ? `${rowPath}${encodeURIComponent(order._id || order.id)}` : viewPath;
      return (
        `<a class="mini-row" href="${href}">` +
        `<span class="status-dot status-${tone}" aria-hidden="true"></span>` +
        `<span class="mini-main"><span class="mini-name">${escapeHtml(order.orderNumber)}</span>` +
        `<span class="mini-meta">${escapeHtml(who + status)}</span></span>` +
        `<span class="mini-trail"><span class="mini-amount">${escapeHtml(formatPrice(order.total))}</span>` +
        `<span class="mini-time">${escapeHtml(shortAgo(order.createdAt))}</span></span>` +
        '</a>'
      );
    })
    .join('');

  return (
    widgetHead(title, 'clock', { label: 'View all', href: viewPath }) +
    `<div class="mini-list">${rows}</div>`
  );
}

/* ---------- Mix bench ---------- */

const MIX_TONE = { queued: 'warning', mixing: 'info', completed: 'success', cancelled: 'danger' };
const MIX_TEXT = { queued: 'Queued', mixing: 'On the bench', completed: 'Completed', cancelled: 'Cancelled' };

/** The custom mixes currently in production, oldest work first on screen. */
export function mixBench(requests, viewPath = '/mixing') {
  if (requests.length === 0) {
    return (
      widgetHead('On the bench', 'flask-conical', { label: 'Full queue', href: viewPath }) +
      empty('The queue is clear.')
    );
  }

  const rows = requests
    .map((request) => {
      const tone = MIX_TONE[request.status] || 'info';
      const status = MIX_TEXT[request.status] || request.status;
      // The requested colour is the fastest way to recognise a job, so it
      // leads the row in place of a generic icon.
      const hex = request.targetColor?.hex || request.formula?.colorHex;
      const chip = hex
        ? `<span class="swatch swatch-sm" style="background-color: ${escapeHtml(hex)}"></span>`
        : `<span class="status-dot status-${tone}" aria-hidden="true"></span>`;
      return (
        `<a class="mini-row" href="${viewPath}?status=${request.status}">${chip}` +
        `<span class="mini-main"><span class="mini-name">${escapeHtml(request.requestNumber)}</span>` +
        `<span class="mini-meta">${escapeHtml(`${request.customerName || 'Walk-in'} · ${status}`)}` +
        `</span></span>` +
        `<span class="mini-trail"><span class="mini-time">${escapeHtml(shortAgo(request.createdAt))}</span></span>` +
        '</a>'
      );
    })
    .join('');

  return (
    widgetHead('On the bench', 'flask-conical', { label: 'Full queue', href: viewPath }) +
    `<div class="mini-list">${rows}</div>`
  );
}
