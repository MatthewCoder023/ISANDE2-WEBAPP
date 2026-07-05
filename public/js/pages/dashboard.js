/**
 * Shared dashboard bootstrap for all roles: loads the current user,
 * fills in name/role placeholders, and wires up logout.
 *
 * Note: real access control happens server-side (the page itself is
 * only served to the correct role). This script is presentation only.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';

const ROLE_LABELS = {
  client: 'Customer',
  paint_mixer: 'Paint Mixer',
  cashier: 'Cashier / Secretary',
  admin: 'System Administrator',
};

async function init() {
  try {
    const { data } = await api('/api/auth/me');
    const { user } = data;

    document.querySelectorAll('[data-user-name]').forEach((el) => {
      el.textContent = user.fullName;
    });
    document.querySelectorAll('[data-user-first-name]').forEach((el) => {
      el.textContent = user.firstName;
    });
    document.querySelectorAll('[data-user-role]').forEach((el) => {
      el.textContent = ROLE_LABELS[user.role] || user.role;
    });
    document.querySelectorAll('[data-user-initials]').forEach((el) => {
      el.textContent = `${user.firstName[0] || ''}${user.lastName[0] || ''}`.toUpperCase();
    });
  } catch {
    // Session expired mid-visit: send the user back to the landing page.
    window.location.assign('/');
    return;
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
