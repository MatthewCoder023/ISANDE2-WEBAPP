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
import { hydrateIcons } from '/js/icons.js';

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

  let user;
  try {
    user = await getCurrentUser();
  } catch {
    // Session expired mid-visit: send the user back to the landing page.
    window.location.assign('/');
    return;
  }

  const navContainer = document.querySelector('[data-nav]');
  if (navContainer) renderNav(navContainer, user.role);

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
