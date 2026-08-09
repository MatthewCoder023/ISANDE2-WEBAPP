/**
 * Where "Back" goes.
 *
 * The topbar button used to call history.back(), which walks the browser's
 * own stack — and the entry sitting behind a freshly loaded dashboard is the
 * sign-in page. So signing in and pressing Back put people straight back on
 * the login form, which reads as having been logged out.
 *
 * The app therefore keeps its own trail of the pages it served. Only
 * authenticated pages record themselves, so an auth screen can never become
 * a Back destination; signing in and signing out clear the trail outright.
 * That keeps the login/logout flow separate from ordinary navigation, which
 * is the whole point: the only way back to the login page is Sign Out.
 *
 * The trail lives in sessionStorage, so it is per tab and disappears when
 * the tab does. Two tabs never share a notion of "the previous page".
 */
/**
 * Home per role, mirroring src/constants/roles.js. The server's /dashboard
 * route forwards to these, and that redirect is what links in the markup
 * use — but knowing whether the page you are *on* is a dashboard needs the
 * concrete paths, since /dashboard is never where anyone actually lands.
 */
export const DASHBOARD_PATHS = {
  client: '/client',
  paint_mixer: '/mixer',
  cashier: '/cashier',
  admin: '/admin',
};

const TRAIL_KEY = 'fc_trail';

/** Deep enough to walk back through any real journey, short enough to stay cheap. */
const MAX_ENTRIES = 20;

/**
 * Pages outside the signed-in app. Nothing here records itself, so these
 * cannot appear in the trail — the check is a standing guarantee rather
 * than a live filter, and it is what makes "never back to login" true by
 * construction instead of by accident.
 */
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify',
]);

/**
 * Where "up" leads when there is no trail to walk — someone opened a
 * deep link from an email, or landed here in a fresh tab. Anything not
 * listed answers to its role's dashboard.
 */
const PARENT_PATHS = {
  '/client/checkout': '/client/products',
  '/client/payment': '/client/orders',
  '/client/track': '/client/orders',
  '/mixing/formulas': '/mixing',
  '/mixing/log': '/mixing',
  '/admin/suppliers': '/admin/purchase-orders',
};

const here = () => window.location.pathname + window.location.search;

const isPublic = (entry) => PUBLIC_PATHS.has(String(entry).split('?')[0]);

function read() {
  try {
    const trail = JSON.parse(sessionStorage.getItem(TRAIL_KEY) || '[]');
    return Array.isArray(trail) ? trail : [];
  } catch {
    return [];
  }
}

function write(trail) {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(-MAX_ENTRIES)));
  } catch {
    /* private mode — Back falls back to the hierarchy below, which always works */
  }
}

/** Signing in or out starts the journey over. */
export function clearTrail() {
  try {
    sessionStorage.removeItem(TRAIL_KEY);
  } catch {
    /* nothing stored means nothing to clear */
  }
}

/**
 * Records the page being viewed. Revisiting somewhere already on the trail
 * rewinds to it rather than stacking a second copy: without that, hopping
 * A → B → A from the sidebar would leave Back bouncing between the two
 * forever instead of continuing outward.
 */
export function recordVisit() {
  const current = here();
  if (isPublic(current)) return;

  const trail = read();
  const seen = trail.lastIndexOf(current);
  if (seen === -1) trail.push(current);
  else trail.length = seen + 1;
  write(trail);
}

/** The page this role answers to when there is nowhere further back to go. */
function fallbackPath(role) {
  const path = window.location.pathname;

  // The invoice is reached from an order, and which list that order lives
  // in depends on who is reading it.
  if (path === '/invoice') return role === 'client' ? '/client/orders' : '/orders';

  return PARENT_PATHS[path] || DASHBOARD_PATHS[role] || '/dashboard';
}

/**
 * Where Back would take you from here, without going there. Entry -1 is the
 * page being viewed, so -2 is the one before it.
 */
export function backTarget(role) {
  const previous = read().at(-2);
  if (previous && !isPublic(previous)) return { path: previous, fromTrail: true };
  return { path: fallbackPath(role), fromTrail: false };
}

/**
 * Steps back one page. Navigates outright rather than calling history.back(),
 * so the destination is the one the app chose and not whatever the browser
 * happens to be holding.
 */
export function goBack(role) {
  const target = backTarget(role);

  const trail = read();
  if (target.fromTrail) {
    trail.pop(); // leave the trail ending on the page we are about to open
    write(trail);
  } else {
    clearTrail(); // stepping outside the trail; the destination starts a new one
  }

  window.location.assign(target.path);
}

/** True on a role's own dashboard — home, where there is no "previous". */
export function isHome(role) {
  return window.location.pathname === DASHBOARD_PATHS[role];
}
