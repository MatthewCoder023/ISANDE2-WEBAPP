/**
 * Shared bootstrap for every authenticated page: loads the current user,
 * mounts the role-appropriate navigation dock, fills user placeholders,
 * and wires up logout.
 *
 * Note: real access control happens server-side (pages are only served
 * to permitted roles). This script is presentation only.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { getCurrentUser } from '/js/session.js';
import { DASHBOARD_PATHS, ROLE_BADGE_CLASS } from '/js/nav.js';
import { hydrateIcons, icon } from '/js/icons.js';
import { hydrateIllustrations } from '/js/illustrations.js';
import { syncReadyMixes } from '/js/cart.js';
import { setupNotifications } from '/js/notifications.js';
import { setupCommandPalette } from '/js/command-palette.js';
import { setupDock } from '/js/dock.js';

/**
 * Light/dark switch, injected above Sign Out in the dock's account menu.
 * Built here rather than in dock.js so the toggle stays one implementation —
 * the command palette clicks this same button.
 */
function setupThemeToggle() {
  const menu = document.querySelector('.dock-account-menu');
  const logoutButton = document.querySelector('#logout-btn');
  if (!menu || !logoutButton) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  // Arrow keys inside the account menu walk [data-menu-item]; the toggle
  // sits between two of them and has to be part of that run.
  button.dataset.menuItem = '';

  const render = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const label = dark ? 'Light Mode' : 'Dark Mode';
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

  menu.insertBefore(button, logoutButton);
}

/**
 * The topbar's leading group: brand, back, page title — in that order, on
 * every authenticated page.
 *
 * The logo is the one fixed point in the interface. It sits in the same
 * place on every module, it is the mark the app is known by, and it doubles
 * as the way home — so the shell always offers one click back to your own
 * dashboard no matter how deep a workflow has taken you. Back sits beside
 * it rather than replacing it: back is where you just were, home is where
 * you start, and a UI that offers only one of those strands people.
 */
function setupTopbarLead(userRole) {
  const topbar = document.querySelector('.dash-topbar');
  if (!topbar || topbar.querySelector('.topbar-brand')) return;

  const home = DASHBOARD_PATHS[userRole] || '/';

  const brand = document.createElement('a');
  brand.className = 'topbar-brand';
  brand.href = home;
  brand.setAttribute('aria-label', 'Flavor & Color — go to your dashboard');
  brand.title = 'Go to your dashboard';
  brand.innerHTML =
    '<img src="/images/logo.png" alt="" class="topbar-logo" />' +
    '<span class="topbar-wordmark">Flavor &amp; Color</span>';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back-button';
  back.setAttribute('aria-label', 'Go back to the previous page');
  back.title = 'Back';
  back.innerHTML = icon('arrow-left', 16);
  back.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(home);
  });

  const rule = document.createElement('span');
  rule.className = 'topbar-rule';
  rule.setAttribute('aria-hidden', 'true');

  const group = document.createElement('div');
  group.className = 'dash-topbar-title';
  group.append(brand, rule, back);

  const title = topbar.querySelector('h1');
  if (title) {
    topbar.replaceChild(group, title);
    group.appendChild(title);
  } else {
    topbar.prepend(group);
  }
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

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // Session expired mid-visit: send the user back to the landing page.
    window.location.assign('/');
    return;
  }

  // Needs the role: both the brand link and the back button's fallback
  // resolve to this user's own dashboard.
  setupTopbarLead(user.role);

  // The dock goes up before anything below it runs: it brings the account
  // menu, and with it the user placeholders, the theme toggle's anchor and
  // the Sign Out button the rest of this function expects to find.
  setupDock(user.role);
  setupThemeToggle();

  // Every role gets a bell; what lands in it differs by role.
  setupNotifications();
  // The palette is built from the same dock config, so it can only ever
  // offer destinations this role already has.
  setupCommandPalette(user.role);

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

  // The user card used to double as the only route to the profile page, so
  // it was given a link role and its own key handling. The account menu now
  // carries a real "My Profile" link right under it, and a plain heading is
  // the honest thing for the card to be.

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
