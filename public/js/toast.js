/**
 * Toast notifications. Usage: showToast('Saved!', 'success')
 * Types: 'info' (default), 'success', 'error', 'warning'
 */
import { icon } from '/js/icons.js';

const DISMISS_AFTER_MS = 4000;

const TOAST_ICONS = {
  info: 'info',
  success: 'check-circle',
  error: 'alert-triangle',
  warning: 'alert-triangle',
};

function getContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.innerHTML = icon(TOAST_ICONS[type] || TOAST_ICONS.info, 16);

  const text = document.createElement('span');
  text.textContent = message; // textContent keeps messages XSS-safe

  toast.append(iconSpan, text);
  getContainer().appendChild(toast);

  setTimeout(() => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, DISMISS_AFTER_MS);
}

const FLASH_KEY = 'fc_flash_toast';

/** Queues a toast to display after a full-page navigation. */
export function flashToast(message, type = 'info') {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type }));
}

/** Shows and clears any queued flash toast. Call once on page load. */
export function showFlashToast() {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return;
    sessionStorage.removeItem(FLASH_KEY);
    const { message, type } = JSON.parse(raw);
    showToast(message, type);
  } catch {
    // Malformed flash payload — nothing to show.
  }
}
