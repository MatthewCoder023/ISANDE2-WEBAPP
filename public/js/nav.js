/**
 * Single source of truth for sidebar navigation, rendered per role by
 * dashboard.js. Server-side page guards remain the real access control —
 * this only decides what links a user sees.
 */
import { icon } from '/js/icons.js';

export const ROLE_BADGE_CLASS = {
  client: 'badge-primary',
  paint_mixer: 'badge-warning',
  cashier: 'badge-info',
  admin: 'badge-danger',
};

const NAV_CONFIG = {
  client: [
    { href: '/client', icon: 'home', label: 'Dashboard' },
    { href: '/client/products', icon: 'palette', label: 'Browse Products' },
    { href: '/client/colors', icon: 'droplets', label: 'Color Studio' },
    { href: '/client/orders', icon: 'package', label: 'My Orders' },
    { href: '/profile', icon: 'user', label: 'My Profile' },
  ],
  paint_mixer: [
    { href: '/mixer', icon: 'home', label: 'Dashboard' },
    { href: '/mixing', icon: 'flask-conical', label: 'Mixing Queue' },
    { href: '/mixing/formulas', icon: 'droplets', label: 'Color Formulas' },
    { href: '/mixing/log', icon: 'clipboard-list', label: 'Production Log' },
  ],
  cashier: [
    { href: '/cashier', icon: 'home', label: 'Dashboard' },
    { href: '/pos', icon: 'shopping-cart', label: 'Point of Sale' },
    { href: '/orders', icon: 'package', label: 'Orders' },
    { href: '/transactions', icon: 'credit-card', label: 'Transactions' },
    { href: '/customers', icon: 'users', label: 'Customers' },
  ],
  admin: [
    { href: '/admin', icon: 'home', label: 'Dashboard' },
    { href: '/admin/products', icon: 'palette', label: 'Products & Inventory' },
    { href: '/pos', icon: 'shopping-cart', label: 'Point of Sale' },
    { href: '/orders', icon: 'package', label: 'Orders' },
    { href: '/transactions', icon: 'credit-card', label: 'Transactions' },
    { href: '/mixing', icon: 'flask-conical', label: 'Paint Mixing' },
    { href: '/admin/users', icon: 'users', label: 'Users & Roles' },
    { href: '/admin/reports', icon: 'bar-chart', label: 'Reports' },
    { href: '/admin/settings', icon: 'settings', label: 'Settings' },
  ],
};

/**
 * The destinations one role may reach. Shared with the command palette so
 * it can only ever offer pages that role's sidebar already offers — the
 * palette must never become a way to discover a page the server refuses.
 */
export function navItemsFor(role) {
  return (NAV_CONFIG[role] || []).filter((item) => !item.soon);
}

/**
 * Pages that are destinations but not nav entries — you reach them from
 * somewhere else, so they have no sidebar link to borrow a name from.
 */
const EXTRA_LABELS = {
  '/client/checkout': 'Cart and Checkout',
  '/client/track': 'Track Order',
  '/invoice': 'Sales Invoice',
  '/dashboard': 'Dashboard',
};

/**
 * What to call a page in prose — used by the Back button so it can name
 * where it leads. Reads the role's own nav first, because one path can go
 * by two names: /mixing is the mixer's "Mixing Queue" and the admin's
 * "Paint Mixing". Returns null when nothing knows the page, leaving the
 * caller to fall back to generic wording.
 */
export function pathLabel(path, role) {
  const own = (NAV_CONFIG[role] || []).find((item) => item.href === path);
  if (own) return own.label;

  for (const items of Object.values(NAV_CONFIG)) {
    const match = items.find((item) => item.href === path);
    if (match) return match.label;
  }
  return EXTRA_LABELS[path] || null;
}

export function renderNav(container, role) {
  const items = NAV_CONFIG[role] || [];
  const currentPath = window.location.pathname;

  // The label is wrapped so the collapsed rail can hide it and leave the
  // icon; `title` then carries the name for the tooltip in that state.
  container.innerHTML = items
    .map((item) => {
      const label = `<span class="nav-label">${item.label}</span>`;
      if (item.soon) {
        return `<a href="#" aria-disabled="true" title="${item.label}">${icon(item.icon)} ${label} <span class="nav-soon">Soon</span></a>`;
      }
      const active = item.href === currentPath ? ' class="is-active"' : '';
      return `<a href="${item.href}"${active} title="${item.label}">${icon(item.icon)} ${label}</a>`;
    })
    .join('');
}
