/**
 * User & employee management (admin): directory with filters, account
 * creation, edits, password resets, deactivation/restore. The server
 * enforces the safety rails (no self-demotion, last admin protected).
 */
import { api } from '/js/api.js';
import { tableSkeleton } from '/js/skeleton.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatDate, formatDateTime, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { getCurrentUser } from '/js/session.js';
import { ROLE_BADGE_CLASS } from '/js/nav.js';
import { hydrateIcons } from '/js/icons.js';

const ROLE_LABELS = {
  client: 'Customer',
  cashier: 'Cashier / Secretary',
  paint_mixer: 'Paint Mixer',
  admin: 'System Administrator',
};

const EVENT_META = {
  login_success: { label: 'Login', badge: 'badge-success' },
  login_failed: { label: 'Failed login', badge: 'badge-danger' },
  login_locked: { label: 'Locked out', badge: 'badge-danger' },
  password_changed: { label: 'Password changed', badge: 'badge-info' },
  password_reset: { label: 'Password reset', badge: 'badge-warning' },
  reset_requested: { label: 'Reset link requested', badge: 'badge-info' },
  role_changed: { label: 'Role changed', badge: 'badge-warning' },
  account_deactivated: { label: 'Deactivated', badge: 'badge-danger' },
  account_reactivated: { label: 'Reactivated', badge: 'badge-success' },
  account_created: { label: 'Account created', badge: 'badge-info' },
};

const state = { page: 1, search: '', role: '', status: '' };
const usersCache = new Map();
let currentAdminId = null;

const tbody = document.querySelector('#users-tbody');
const emptyState = document.querySelector('#empty-state');
const paginationEl = document.querySelector('#pagination');

const userModal = initModal(document.querySelector('#user-modal'));
const passwordModal = initModal(document.querySelector('#password-modal'));
const confirmModal = initModal(document.querySelector('#confirm-modal'));

const userForm = document.querySelector('#user-form');
const passwordForm = document.querySelector('#password-form');
let passwordUserId = null;
let confirmAction = null;

/* ---------- List ---------- */

async function loadUsers() {
  tableSkeleton(tbody, 6);
  const params = new URLSearchParams({ page: state.page, limit: 10 });
  if (state.search) params.set('search', state.search);
  if (state.role) params.set('role', state.role);
  if (state.status) params.set('status', state.status);

  try {
    const { data } = await api(`/api/users?${params}`);
    renderTable(data.users);
    renderPagination(paginationEl, data.pagination, (page) => {
      state.page = page;
      loadUsers();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderTable(users) {
  usersCache.clear();
  users.forEach((u) => usersCache.set(u.id, u));

  emptyState.hidden = users.length > 0;

  tbody.innerHTML = users
    .map((u) => {
      const isSelf = u.id === currentAdminId;
      const roleBadge = `<span class="badge ${ROLE_BADGE_CLASS[u.role] || 'badge-info'}">${ROLE_LABELS[u.role] || escapeHtml(u.role)}</span>`;
      const statusBadge = u.isActive
        ? '<span class="badge badge-dot badge-success">Active</span>'
        : '<span class="badge badge-dot badge-danger">Deactivated</span>';
      const toggleButton = isSelf
        ? ''
        : u.isActive
          ? `<button class="btn btn-outline btn-sm" data-action="deactivate" data-id="${u.id}">Deactivate</button>`
          : `<button class="btn btn-primary btn-sm" data-action="restore" data-id="${u.id}">Restore</button>`;

      return `
        <tr>
          <td>
            <div class="product-cell" style="min-width: 180px;">
              <span class="dash-user-avatar" style="background-color: var(--primary-600);">
                ${escapeHtml(`${u.firstName[0] || ''}${u.lastName[0] || ''}`.toUpperCase())}
              </span>
              <div>
                <div class="name">${escapeHtml(u.fullName)}${isSelf ? ' <span class="badge badge-info">You</span>' : ''}</div>
              </div>
            </div>
          </td>
          <td>
            ${escapeHtml(u.email)}
            ${u.phone ? `<div class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(u.phone)}</div>` : ''}
          </td>
          <td>${roleBadge}</td>
          <td>${formatDate(u.createdAt)}</td>
          <td>${statusBadge}</td>
          <td>
            <div class="cell-actions">
              <button class="btn btn-outline btn-sm" data-action="edit" data-id="${u.id}">Edit</button>
              <button class="btn btn-outline btn-sm" data-action="password" data-id="${u.id}">Reset Password</button>
              ${toggleButton}
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

/* ---------- Security log ---------- */

const eventsTbody = document.querySelector('#events-tbody');
const eventsEmpty = document.querySelector('#events-empty');
const eventsPagination = document.querySelector('#events-pagination');
const eventState = { page: 1, type: '' };

async function loadEvents() {
  tableSkeleton(eventsTbody, 5);
  const params = new URLSearchParams({ page: eventState.page, limit: 10 });
  if (eventState.type) params.set('type', eventState.type);

  try {
    const { data } = await api(`/api/users/events?${params}`);
    renderEvents(data.events);
    renderPagination(eventsPagination, data.pagination, (page) => {
      eventState.page = page;
      loadEvents();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderEvents(items) {
  eventsEmpty.hidden = items.length > 0;

  eventsTbody.innerHTML = items
    .map((event) => {
      const meta = EVENT_META[event.type] || { label: event.type, badge: 'badge-info' };
      const details = [event.note, event.ip ? `IP ${event.ip}` : '']
        .filter(Boolean)
        .join(' · ');
      return `
        <tr>
          <td style="white-space: nowrap;">${formatDateTime(event.createdAt)}</td>
          <td><span class="badge badge-dot ${meta.badge}">${meta.label}</span></td>
          <td>${escapeHtml(event.email || '—')}</td>
          <td>${escapeHtml(event.actorName || '—')}</td>
          <td class="text-muted" style="font-size: 0.8125rem;">${escapeHtml(details || '—')}</td>
        </tr>`;
    })
    .join('');
}

document.querySelector('#event-filter').addEventListener('change', (event) => {
  eventState.type = event.target.value;
  eventState.page = 1;
  loadEvents();
});

/* ---------- Filters ---------- */

document.querySelector('#search-input').addEventListener(
  'input',
  debounce((event) => {
    state.search = event.target.value.trim();
    state.page = 1;
    loadUsers();
  })
);

for (const [selector, key] of [
  ['#role-filter', 'role'],
  ['#status-filter', 'status'],
]) {
  document.querySelector(selector).addEventListener('change', (event) => {
    state[key] = event.target.value;
    state.page = 1;
    loadUsers();
  });
}

/* ---------- Create / edit ---------- */

function openUserModal(user = null) {
  clearFieldErrors(userForm);
  userForm.reset();
  userForm.userId.value = user ? user.id : '';

  const isSelf = user && user.id === currentAdminId;
  document.querySelector('#user-modal-title').textContent = user ? 'Edit Account' : 'New Account';
  userForm.email.disabled = Boolean(user);
  document.querySelector('#email-hint').hidden = !user;
  document.querySelector('#password-group').hidden = Boolean(user);
  // The server blocks self role changes; disable the control to match.
  userForm.role.disabled = Boolean(isSelf);

  if (user) {
    userForm.firstName.value = user.firstName;
    userForm.lastName.value = user.lastName;
    userForm.email.value = user.email;
    userForm.phone.value = user.phone || '';
    userForm.role.value = user.role;
  }

  userModal.open();
}

document.querySelector('#add-user-btn').addEventListener('click', () => openUserModal());

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(userForm);

  const userId = userForm.userId.value;
  const body = {
    firstName: userForm.firstName.value,
    lastName: userForm.lastName.value,
    phone: userForm.phone.value,
  };
  if (!userForm.role.disabled) body.role = userForm.role.value;
  if (!userId) {
    body.email = userForm.email.value;
    body.password = userForm.password.value;
  }

  const saveButton = document.querySelector('#user-save-btn');
  setBusy(saveButton, true, 'Saving…');

  try {
    const result = userId
      ? await api(`/api/users/${userId}`, { method: 'PATCH', body })
      : await api('/api/users', { method: 'POST', body });
    showToast(result.message, 'success');
    userModal.close();
    loadUsers();
    loadEvents();
  } catch (error) {
    if (error.errors) showFieldErrors(userForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

/* ---------- Reset password ---------- */

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!passwordUserId) return;
  clearFieldErrors(passwordForm);

  const saveButton = document.querySelector('#password-save-btn');
  setBusy(saveButton, true, 'Resetting…');

  try {
    const { message } = await api(`/api/users/${passwordUserId}/reset-password`, {
      method: 'POST',
      body: { password: passwordForm.password.value },
    });
    showToast(message, 'success');
    passwordModal.close();
    passwordUserId = null;
    loadEvents();
  } catch (error) {
    if (error.errors) showFieldErrors(passwordForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

/* ---------- Deactivate / restore ---------- */

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!confirmAction) return;
  try {
    const { message } = await confirmAction();
    showToast(message, 'success');
    loadUsers();
    loadEvents();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    confirmAction = null;
    confirmModal.close();
  }
});

function openConfirm(message, buttonLabel, buttonClass, action) {
  document.querySelector('#confirm-message').textContent = message;
  const button = document.querySelector('#confirm-btn');
  button.textContent = buttonLabel;
  button.className = `btn ${buttonClass}`;
  confirmAction = action;
  confirmModal.open();
}

/* ---------- Table actions ---------- */

tbody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const user = usersCache.get(button.dataset.id);
  if (!user) return;

  switch (button.dataset.action) {
    case 'edit':
      openUserModal(user);
      break;
    case 'password':
      passwordUserId = user.id;
      clearFieldErrors(passwordForm);
      passwordForm.reset();
      document.querySelector('#password-user-name').textContent = user.fullName;
      passwordModal.open();
      break;
    case 'deactivate':
      openConfirm(
        `Deactivate ${user.fullName}? They will be signed out immediately and unable to log in until restored.`,
        'Deactivate',
        'btn-danger',
        () => api(`/api/users/${user.id}`, { method: 'PATCH', body: { isActive: false } })
      );
      break;
    case 'restore':
      openConfirm(
        `Restore ${user.fullName}'s access?`,
        'Restore',
        'btn-primary',
        () => api(`/api/users/${user.id}`, { method: 'PATCH', body: { isActive: true } })
      );
      break;
  }
});

/* ---------- Init ---------- */

async function init() {
  hydrateIcons();
  const me = await getCurrentUser();
  currentAdminId = me.id;
  loadUsers();
  loadEvents();
}

init();
