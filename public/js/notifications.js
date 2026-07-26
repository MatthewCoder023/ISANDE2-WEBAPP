/**
 * Notification bell, injected into the topbar of every authenticated page
 * by the shared bootstrap.
 *
 * Deliberately polled rather than streamed: a shop has a handful of people
 * signed in, a request every couple of minutes costs nothing, and there is
 * no connection to leak behind a proxy. Polling pauses entirely while the
 * tab is hidden — browsers throttle background timers anyway, and there is
 * no point asking about news nobody is looking at.
 */
import { api } from '/js/api.js';
import { icon } from '/js/icons.js';
import { escapeHtml, formatDateTime } from '/js/format.js';

const POLL_MS = 90_000;

const TYPE_ICONS = {
  order_payment_verified: 'check-circle',
  order_payment_rejected: 'alert-triangle',
  order_ready: 'shopping-bag',
  order_auto_cancelled: 'info',
  mix_ready: 'droplets',
  proof_uploaded: 'credit-card',
  mix_requested: 'flask-conical',
};

let panelOpen = false;
let pollTimer = null;

function markup() {
  return `
    <div class="notif" data-notif>
      <button type="button" class="notif-button" id="notif-button"
              aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
        ${icon('bell', 19)}
        <span class="notif-badge" id="notif-badge" hidden></span>
      </button>
      <div class="notif-panel" id="notif-panel" role="dialog" aria-label="Notifications" hidden>
        <header class="notif-panel-head">
          <strong>Notifications</strong>
          <button type="button" class="btn-link" id="notif-read-all">Mark all read</button>
        </header>
        <div class="notif-list" id="notif-list"></div>
      </div>
    </div>`;
}

function renderBadge(unread) {
  const badge = document.querySelector('#notif-badge');
  if (!badge) return;
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? '9+' : String(unread);
}

function renderList(notifications) {
  const list = document.querySelector('#notif-list');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<p class="notif-empty">Nothing new. We\'ll tell you when something happens.</p>';
    return;
  }

  list.innerHTML = notifications
    .map(
      (n) => `
      <a class="notif-item${n.readAt ? '' : ' is-unread'}" data-id="${n.id}"
         href="${escapeHtml(n.link || '#')}">
        <span class="notif-item-icon">${icon(TYPE_ICONS[n.type] || 'info', 16)}</span>
        <span class="notif-item-body">
          <span class="notif-item-title">${escapeHtml(n.title)}</span>
          ${n.body ? `<span class="notif-item-text">${escapeHtml(n.body)}</span>` : ''}
          <span class="notif-item-time">${formatDateTime(n.createdAt)}</span>
        </span>
      </a>`
    )
    .join('');
}

async function refreshBadge() {
  try {
    const { data } = await api('/api/notifications/unread-count');
    renderBadge(data.unread);
  } catch {
    // Offline or session gone — the badge simply doesn't update.
  }
}

async function openPanel() {
  const panel = document.querySelector('#notif-panel');
  panel.hidden = false;
  panelOpen = true;
  document.querySelector('#notif-button').setAttribute('aria-expanded', 'true');

  document.querySelector('#notif-list').innerHTML = '<p class="notif-empty">Loading…</p>';
  try {
    const { data } = await api('/api/notifications');
    renderList(data.notifications);
    renderBadge(data.unread);
  } catch {
    document.querySelector('#notif-list').innerHTML =
      '<p class="notif-empty">Could not load notifications.</p>';
  }
}

function closePanel() {
  const panel = document.querySelector('#notif-panel');
  if (!panel) return;
  panel.hidden = true;
  panelOpen = false;
  document.querySelector('#notif-button').setAttribute('aria-expanded', 'false');
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshBadge, POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/** Injects the bell before the role badge in the topbar. */
export function setupNotifications() {
  const topbar = document.querySelector('.dash-topbar');
  if (!topbar || topbar.querySelector('[data-notif]')) return;

  topbar.insertAdjacentHTML('beforeend', markup());

  document.querySelector('#notif-button').addEventListener('click', (event) => {
    event.stopPropagation();
    if (panelOpen) closePanel();
    else openPanel();
  });

  // Clicking through to the linked page marks that one read on the way.
  document.querySelector('#notif-list').addEventListener('click', (event) => {
    const item = event.target.closest('.notif-item');
    if (!item) return;
    api(`/api/notifications/${item.dataset.id}/read`, { method: 'POST' }).catch(() => {});
  });

  document.querySelector('#notif-read-all').addEventListener('click', async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST' });
      document
        .querySelectorAll('.notif-item.is-unread')
        .forEach((el) => el.classList.remove('is-unread'));
      renderBadge(0);
    } catch {
      // Leave the panel as it is; the next open will show the truth.
    }
  });

  document.addEventListener('click', (event) => {
    if (panelOpen && !event.target.closest('[data-notif]')) closePanel();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && panelOpen) closePanel();
  });

  // Only poll while someone is actually looking at the page.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      refreshBadge();
      startPolling();
    }
  });

  refreshBadge();
  if (!document.hidden) startPolling();
}
