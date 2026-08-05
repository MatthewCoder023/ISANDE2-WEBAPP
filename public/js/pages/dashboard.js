/**
 * Shared bootstrap for every authenticated page: loads the current user,
 * renders the role-appropriate sidebar nav, fills user placeholders,
 * and wires up logout.
 *
 * Note: real access control happens server-side (pages are only served
 * to permitted roles). This script is presentation only.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { getCurrentUser } from '/js/session.js';
import { renderNav, DASHBOARD_PATHS, ROLE_BADGE_CLASS } from '/js/nav.js';
import { hydrateIcons, icon } from '/js/icons.js';
import { hydrateIllustrations } from '/js/illustrations.js';
import { syncReadyMixes } from '/js/cart.js';
import { setupNotifications } from '/js/notifications.js';
import { setupCommandPalette } from '/js/command-palette.js';

/** Light/dark switch, injected above Sign Out on every authed page. */
function setupThemeToggle() {
  const footer = document.querySelector('.dash-sidebar-footer');
  const logoutButton = document.querySelector('#logout-btn');
  if (!footer || !logoutButton) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';

  const render = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const label = dark ? 'Light Mode' : 'Dark Mode';
    // The label is wrapped so the collapsed rail can hide it; title keeps
    // the meaning available once only the glyph is showing.
    button.innerHTML = `${icon(dark ? 'sun' : 'moon', 15)} <span>${label}</span>`;
    button.title = label;
    button.setAttribute('aria-pressed', String(dark));
  };
  render();

  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('fc_theme', next);
    } catch {
      /* private mode — the choice just won't persist */
    }
    render();
  });

  footer.insertBefore(button, logoutButton);
}

/**
 * Sets up the back button in the topbar with role-based fallback path.
 */
function setupBackButton(userRole) {
  const topbar = document.querySelector('.dash-topbar');
  if (!topbar || topbar.querySelector('.back-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'back-button';
  button.setAttribute('aria-label', 'Go back to the previous page');
  button.innerHTML = `${icon('arrow-left', 16)}`;

  const fallbackPath = DASHBOARD_PATHS[userRole] || '/';
  button.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign(fallbackPath);
    }
  });

  const title = topbar.querySelector('h1');
  if (title) {
    const titleGroup = document.createElement('div');
    titleGroup.className = 'dash-topbar-title';
    titleGroup.appendChild(button);

    topbar.replaceChild(titleGroup, title);
    titleGroup.appendChild(title);
  } else {
    topbar.prepend(button);
  }
}

/**
 * Collapses the sidebar to an icon rail and remembers the choice.
 *
 * The preference is stamped on <html> by theme.js before first paint, so
 * this only has to handle the toggling. It is a desktop affordance: below
 * 860px the sidebar is already a drawer, and the CSS scopes the rail above
 * that width so the two never fight.
 */
function setupSidebarRail() {
  const topbar = document.querySelector('.dash-topbar');
  const logout = document.querySelector('#logout-btn');
  if (!topbar || topbar.querySelector('.rail-toggle')) return;

  // Sign Out is plain text in the views; give it a glyph so it survives
  // the collapse, and wrap the words so they can step aside.
  if (logout && !logout.querySelector('span')) {
    logout.innerHTML = `${icon('log-out', 15)} <span>${logout.textContent.trim()}</span>`;
    logout.title = 'Sign Out';
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rail-toggle';
  button.innerHTML = icon('panel-left', 18);

  const render = () => {
    const collapsed = document.documentElement.dataset.rail === '1';
    button.setAttribute('aria-pressed', String(collapsed));
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  render();

  button.addEventListener('click', () => {
    const collapsed = document.documentElement.dataset.rail === '1';
    if (collapsed) delete document.documentElement.dataset.rail;
    else document.documentElement.dataset.rail = '1';
    try {
      localStorage.setItem('fc_rail', collapsed ? '0' : '1');
    } catch {
      /* private mode — the choice just won't persist */
    }
    render();
  });

  topbar.prepend(button);
}

/**
 * On phones the sidebar becomes a drawer. The toggle lives in the topbar,
 * a scrim covers the page behind it, and choosing a destination closes it —
 * otherwise the drawer would still be sitting over the page you just asked for.
 */

function setupMobileNav() {
  const sidebar = document.querySelector('.dash-sidebar');
  const topbar = document.querySelector('.dash-topbar');
  if (!sidebar || !topbar || topbar.querySelector('.nav-toggle')) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-label', 'Open navigation');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = icon('menu', 20);
  topbar.prepend(toggle);

  const scrim = document.createElement('div');
  scrim.className = 'nav-scrim';
  document.body.appendChild(scrim);

  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };

  toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
  scrim.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
}

const ROLE_LABELS = {
  client: 'Customer',
  paint_mixer: 'Paint Mixer',
  cashier: 'Cashier / Secretary',
  admin: 'System Administrator',
};

async function init() {
  // Fill static [data-icon] placeholders immediately — no need to wait
  // for the session lookup.
  hydrateIcons();
  hydrateIllustrations();
  setupThemeToggle();

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // Session expired mid-visit: send the user back to the landing page.
    window.location.assign('/');
    return;
  }

  // Set up back button after user is fetched for role-based fallback
  setupBackButton(user.role);

  const navContainer = document.querySelector('[data-nav]');
  if (navContainer) renderNav(navContainer, user.role);

  // Every role gets a bell; what lands in it differs by role.
  setupNotifications();
  setupMobileNav();
  setupSidebarRail();
  // The palette is built from the same nav config as the sidebar, so it can
  // only ever offer destinations this role already has.
  setupCommandPalette(user.role);

  document.querySelectorAll('[data-brand-link]').forEach((el) => {
    el.setAttribute('href', DASHBOARD_PATHS[user.role] || '/');
  });

  document.querySelectorAll('[data-user-name]').forEach((el) => {
    el.textContent = user.fullName;
  });
  document.querySelectorAll('[data-user-first-name]').forEach((el) => {
    el.textContent = user.firstName;
  });
  document.querySelectorAll('[data-user-initials]').forEach((el) => {
    el.textContent = `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase();
  });
  document.querySelectorAll('[data-user-role]').forEach((el) => {
    el.textContent = ROLE_LABELS[user.role] || user.role;
    // Topbar badges on shared pages get their color from the role.
    if (el.classList.contains('badge') && ![...el.classList].some((c) => c.startsWith('badge-'))) {
      el.classList.add(ROLE_BADGE_CLASS[user.role]);
    }
  });

  /**
   * A finished custom mix should simply be waiting in the cart. Runs on
   * every customer page (not just the shop) so the news reaches them
   * wherever they land, and never blocks the rest of the bootstrap.
   */
  if (user.role === 'client') {
    syncReadyMixes(user.id).then((mixes) => {
      if (mixes.length === 0) return;
      const label =
        mixes.length === 1
          ? `Your custom mix ${mixes[0].requestNumber} is ready — it's in your cart.`
          : `${mixes.length} custom mixes are ready — they're in your cart.`;
      showToast(label, 'success');
    });
  }

  // The sidebar user card links to the profile page for every role.
  const userCard = document.querySelector('.dash-user');
  if (userCard) {
    userCard.setAttribute('role', 'link');
    userCard.setAttribute('tabindex', '0');
    userCard.setAttribute('title', 'My Profile');
    const goToProfile = () => window.location.assign('/profile');
    userCard.addEventListener('click', goToProfile);
    userCard.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToProfile();
      }
    });
  }

  const logoutButton = document.querySelector('#logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
        window.location.assign('/');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }
}

init();
