/**
 * Single source of truth for sidebar navigation, rendered per role by
 * dashboard.js. Server-side page guards remain the real access control —
 * this only decides what links a user sees.
 */
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
    { href: '/client', icon: '🏠', label: 'Dashboard' },
    { href: '/client/products', icon: '🎨', label: 'Browse Products' },
    { href: '/client/orders', icon: '📦', label: 'My Orders' },
    { icon: '👤', label: 'My Profile', soon: true },
  ],
  paint_mixer: [
    { href: '/mixer', icon: '🏠', label: 'Dashboard' },
    { icon: '🧪', label: 'Mixing Queue', soon: true },
    { icon: '🎨', label: 'Color Formulas', soon: true },
    { icon: '📋', label: 'Production Log', soon: true },
  ],
  cashier: [
    { href: '/cashier', icon: '🏠', label: 'Dashboard' },
    { href: '/pos', icon: '🛒', label: 'Point of Sale' },
    { href: '/orders', icon: '📦', label: 'Orders' },
    { href: '/transactions', icon: '💳', label: 'Transactions' },
    { icon: '👥', label: 'Customers', soon: true },
  ],
  admin: [
    { href: '/admin', icon: '🏠', label: 'Dashboard' },
    { href: '/admin/products', icon: '🎨', label: 'Products & Inventory' },
    { href: '/pos', icon: '🛒', label: 'Point of Sale' },
    { href: '/orders', icon: '📦', label: 'Orders' },
    { href: '/transactions', icon: '💳', label: 'Transactions' },
    { icon: '👥', label: 'Users & Roles', soon: true },
    { icon: '📊', label: 'Reports', soon: true },
    { icon: '⚙️', label: 'Settings', soon: true },
  ],
};

export function renderNav(container, role) {
  const items = NAV_CONFIG[role] || [];
  const currentPath = window.location.pathname;

  container.innerHTML = items
    .map((item) => {
      if (item.soon) {
        return `<a href="#" aria-disabled="true">${item.icon} ${item.label} <span class="nav-soon">Soon</span></a>`;
      }
      const active = item.href === currentPath ? ' class="is-active"' : '';
      return `<a href="${item.href}"${active}>${item.icon} ${item.label}</a>`;
    })
    .join('');
}
