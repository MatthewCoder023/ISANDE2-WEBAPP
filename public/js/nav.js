/**
 * Single source of truth for sidebar navigation, rendered per role by
 * dashboard.js. Server-side page guards remain the real access control —
 * this only decides what links a user sees.
 */
import { icon } from '/js/icons.js';

export const DASHBOARD_PATHS = {
  client: '/client',
  paint_mixer: '/mixer',
  cashier: '/cashier',
  admin: '/admin',
};

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
    { icon: 'user', label: 'My Profile', soon: true },
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
    { icon: 'users', label: 'Customers', soon: true },
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

export function renderNav(container, role) {
  const items = NAV_CONFIG[role] || [];
  const currentPath = window.location.pathname;

  container.innerHTML = items
    .map((item) => {
      if (item.soon) {
        return `<a href="#" aria-disabled="true">${icon(item.icon)} ${item.label} <span class="nav-soon">Soon</span></a>`;
      }
      const active = item.href === currentPath ? ' class="is-active"' : '';
      return `<a href="${item.href}"${active}>${icon(item.icon)} ${item.label}</a>`;
    })
    .join('');
}
