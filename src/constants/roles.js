/**
 * Central role definitions. Every authorization check in the app
 * must reference these constants — never hard-code role strings.
 */
const ROLES = Object.freeze({
  CLIENT: 'client',
  PAINT_MIXER: 'paint_mixer',
  CASHIER: 'cashier',
  ADMIN: 'admin',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

const STAFF_ROLES = Object.freeze([ROLES.PAINT_MIXER, ROLES.CASHIER, ROLES.ADMIN]);

/** Where each role lands after login. */
const DASHBOARD_PATHS = Object.freeze({
  [ROLES.CLIENT]: '/client',
  [ROLES.PAINT_MIXER]: '/mixer',
  [ROLES.CASHIER]: '/cashier',
  [ROLES.ADMIN]: '/admin',
});

/** Human-readable labels for UI display. */
const ROLE_LABELS = Object.freeze({
  [ROLES.CLIENT]: 'Customer',
  [ROLES.PAINT_MIXER]: 'Paint Mixer',
  [ROLES.CASHIER]: 'Cashier / Secretary',
  [ROLES.ADMIN]: 'System Administrator',
});

module.exports = { ROLES, ALL_ROLES, STAFF_ROLES, DASHBOARD_PATHS, ROLE_LABELS };
