/**
 * Single source of truth for navigation, rendered per role by the dock
 * (/js/dock.js) and mirrored by the command palette. Server-side page
 * guards remain the real access control — this only decides what a user
 * is offered.
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

/**
 * The pages each role may reach. This is the allow-list the dock is checked
 * against, so it stays the narrow definition: one entry per destination the
 * server will actually serve this role.
 */
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

/** Served to any signed-in user regardless of role (requirePageAuth()). */
const SHARED_PATHS = ['/profile'];

/**
 * The destinations one role may reach, flat. Used as the allow-list for the
 * dock and by anything that needs the plain list.
 */
export function navItemsFor(role) {
  return (NAV_CONFIG[role] || []).filter((item) => !item.soon);
}

/**
 * Dock layout: one tile per module, each optionally opening a menu of views
 * within that module.
 *
 * Every sub-item is a real URL. The filtered ones lean on the query-string
 * seeding the list pages already do (see /js/url-filters.js), so "Ready for
 * Pickup" opens the orders table with its own status filter already set —
 * nothing here needs a new route, a new page, or a server change.
 *
 * The first tile of every role is that role's own dashboard, so the dock
 * always starts at home. The logo itself lives in the topbar rather than
 * here — one mark, one place, on every page.
 */
const DOCK_CONFIG = {
  client: [
    { icon: 'home', label: 'Dashboard', href: '/client' },
    { icon: 'palette', label: 'Browse Paints', href: '/client/products' },
    { icon: 'droplets', label: 'Color Studio', href: '/client/colors' },
    {
      icon: 'package',
      label: 'My Orders',
      href: '/client/orders',
      items: [
        { label: 'All Orders', href: '/client/orders' },
        { label: 'Active Orders', href: '/client/orders?status=active' },
        { label: 'Awaiting Payment', href: '/client/orders?status=pending_payment' },
        { label: 'Ready for Pickup', href: '/client/orders?status=ready' },
        { label: 'Completed', href: '/client/orders?status=completed' },
      ],
    },
  ],
  paint_mixer: [
    { icon: 'home', label: 'Dashboard', href: '/mixer' },
    {
      icon: 'flask-conical',
      label: 'Mixing Queue',
      href: '/mixing',
      items: [
        { label: 'All Requests', href: '/mixing' },
        { label: 'Active', href: '/mixing?status=active' },
        { label: 'Queued', href: '/mixing?status=queued' },
        { label: 'In Progress', href: '/mixing?status=mixing' },
      ],
    },
    { icon: 'droplets', label: 'Color Formulas', href: '/mixing/formulas' },
    { icon: 'clipboard-list', label: 'Production Log', href: '/mixing/log' },
  ],
  cashier: [
    { icon: 'home', label: 'Dashboard', href: '/cashier' },
    {
      icon: 'shopping-cart',
      label: 'Point of Sale',
      href: '/pos',
      items: [
        { label: 'New Sale', href: '/pos' },
        { label: 'Walk-in Sales', href: '/orders?type=walk_in' },
        { label: 'Online Orders', href: '/orders?type=online' },
      ],
    },
    {
      icon: 'package',
      label: 'Orders',
      href: '/orders',
      items: [
        { label: 'All Orders', href: '/orders' },
        { label: 'Pending Payment', href: '/orders?status=pending_payment' },
        { label: 'Awaiting Verification', href: '/orders?status=pending_verification' },
        { label: 'Preparing', href: '/orders?status=preparing' },
        { label: 'Ready for Pickup', href: '/orders?status=ready' },
        { label: 'Completed', href: '/orders?status=completed' },
      ],
    },
    {
      icon: 'credit-card',
      label: 'Transactions',
      href: '/transactions',
      items: [
        { label: 'All Payments', href: '/transactions' },
        { label: 'Cash', href: '/transactions?method=cash' },
        { label: 'GCash', href: '/transactions?method=gcash' },
        { label: 'Card', href: '/transactions?method=card' },
      ],
    },
    { icon: 'users', label: 'Customers', href: '/customers' },
  ],
  admin: [
    { icon: 'home', label: 'Dashboard', href: '/admin' },
    {
      icon: 'shopping-cart',
      label: 'Point of Sale',
      href: '/pos',
      items: [
        { label: 'New Sale', href: '/pos' },
        { label: 'Walk-in Sales', href: '/orders?type=walk_in' },
        { label: 'Online Orders', href: '/orders?type=online' },
        { label: 'Custom Paint Mix', href: '/mixing' },
      ],
    },
    {
      icon: 'package',
      label: 'Orders',
      href: '/orders',
      items: [
        { label: 'All Orders', href: '/orders' },
        { label: 'Pending Payment', href: '/orders?status=pending_payment' },
        { label: 'Awaiting Verification', href: '/orders?status=pending_verification' },
        { label: 'Preparing', href: '/orders?status=preparing' },
        { label: 'Ready for Pickup', href: '/orders?status=ready' },
        { label: 'Completed', href: '/orders?status=completed' },
      ],
    },
    {
      icon: 'credit-card',
      label: 'Transactions',
      href: '/transactions',
      items: [
        { label: 'All Payments', href: '/transactions' },
        { label: 'Cash', href: '/transactions?method=cash' },
        { label: 'GCash', href: '/transactions?method=gcash' },
        { label: 'Card', href: '/transactions?method=card' },
      ],
    },
    {
      icon: 'palette',
      label: 'Inventory',
      href: '/admin/products',
      items: [
        { label: 'All Products', href: '/admin/products' },
        { label: 'Low Stock', href: '/admin/products?stock=low' },
        { label: 'Out of Stock', href: '/admin/products?stock=out' },
        { label: 'Archived', href: '/admin/products?status=archived' },
      ],
    },
    // Nine destinations is too many tiles; the four an admin opens least
    // often live behind one. Menu-only — there is nothing sensible for a
    // click on "More" itself to navigate to.
    {
      icon: 'menu',
      label: 'More',
      // Paint Mixing is not repeated here: the POS menu already offers it as
      // "Custom Paint Mix", and one page reached from two tiles is how a
      // dock starts feeling arbitrary.
      items: [
        { label: 'Reports', href: '/admin/reports' },
        { label: 'Users & Roles', href: '/admin/users' },
        { label: 'Settings', href: '/admin/settings' },
      ],
    },
  ],
};

/**
 * The dock for a role, with anything the role cannot reach removed.
 *
 * The dock groups pages by module, which means its shape can drift from
 * NAV_CONFIG as either list is edited. Rather than trusting the two to stay
 * in step, every href is checked against the role's allow-list here: an item
 * pointing somewhere the server would refuse is dropped, and a group left
 * with no reachable items disappears with it. The dock is a faster route to
 * what a role already has, never a way to discover more.
 */
export function dockGroupsFor(role) {
  const allowed = new Set([...navItemsFor(role).map((item) => item.href), ...SHARED_PATHS]);
  const reachable = (href) => allowed.has(new URL(href, window.location.origin).pathname);

  return (DOCK_CONFIG[role] || [])
    .map((group) => {
      const items = (group.items || []).filter((item) => reachable(item.href));
      if (group.items && items.length === 0) return null;
      if (group.href && !reachable(group.href)) return null;
      return { ...group, items };
    })
    .filter(Boolean);
}

/**
 * Every dock destination as a flat list, for the command palette. Groups
 * that navigate contribute themselves; their sub-items follow, prefixed so
 * "ready" finds "Orders — Ready for Pickup" and not just a bare status name.
 */
export function dockDestinations(role) {
  const destinations = [];

  for (const group of dockGroupsFor(role)) {
    if (group.href) {
      destinations.push({ label: group.label, href: group.href, icon: group.icon });
    }
    for (const item of group.items) {
      if (item.href === group.href) continue; // "New Sale" is just /pos again
      destinations.push({
        // A menu-only tile like "More" is a container, not a place; its
        // items read better under their own names.
        label: group.href ? `${group.label} — ${item.label}` : item.label,
        href: item.href,
        icon: group.icon,
      });
    }
  }

  return destinations;
}
