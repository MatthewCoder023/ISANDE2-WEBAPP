/** Self-service profile: account details and password change. */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { formatDate } from '/js/format.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { addPasswordToggle, addPasswordChecklist } from '/js/password-ui.js';
import { getCurrentUser } from '/js/session.js';

const profileForm = document.querySelector('#profile-form');
const passwordForm = document.querySelector('#password-form');

addPasswordToggle(passwordForm.currentPassword);
addPasswordToggle(passwordForm.newPassword);
addPasswordToggle(passwordForm.confirmPassword);
addPasswordChecklist(passwordForm.newPassword);

async function loadProfile() {
  const user = await getCurrentUser();
  profileForm.firstName.value = user.firstName;
  profileForm.lastName.value = user.lastName;
  document.querySelector('#pr-email').value = user.email;
  profileForm.phone.value = user.phone || '';
  document.querySelector('#profile-joined').textContent = formatDate(user.createdAt);
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(profileForm);

  const saveButton = document.querySelector('#profile-save-btn');
  setBusy(saveButton, true, 'Saving…');

  try {
    const { message, data } = await api('/api/auth/profile', {
      method: 'PATCH',
      body: {
        firstName: profileForm.firstName.value,
        lastName: profileForm.lastName.value,
        phone: profileForm.phone.value,
      },
    });
    showToast(message, 'success');

    // Refresh the sidebar name/initials without a full reload.
    document.querySelectorAll('[data-user-name]').forEach((el) => {
      el.textContent = data.user.fullName;
    });
    document.querySelectorAll('[data-user-initials]').forEach((el) => {
      el.textContent =
        `${data.user.firstName[0] || ''}${data.user.lastName[0] || ''}`.toUpperCase();
    });
  } catch (error) {
    if (error.errors) showFieldErrors(profileForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(passwordForm);

  if (passwordForm.newPassword.value !== passwordForm.confirmPassword.value) {
    showFieldErrors(passwordForm, [
      { field: 'confirmPassword', message: 'Passwords do not match.' },
    ]);
    return;
  }

  const saveButton = document.querySelector('#password-save-btn');
  setBusy(saveButton, true, 'Changing…');

  try {
    const { message } = await api('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.currentPassword.value,
        newPassword: passwordForm.newPassword.value,
      },
    });
    showToast(message, 'success');
    passwordForm.reset();
  } catch (error) {
    if (error.errors) showFieldErrors(passwordForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(saveButton, false);
  }
});

loadProfile();
