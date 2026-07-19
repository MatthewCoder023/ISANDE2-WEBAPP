import { api } from '/js/api.js';
import { showToast, flashToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { addPasswordToggle, addPasswordChecklist } from '/js/password-ui.js';

const form = document.querySelector('#reset-form');
const submitButton = form.querySelector('button[type="submit"]');
const token = new URLSearchParams(window.location.search).get('token');

addPasswordToggle(form.newPassword);
addPasswordToggle(form.confirmPassword);
addPasswordChecklist(form.newPassword);

if (!token) {
  form.hidden = true;
  document.querySelector('#invalid-note').hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);

  if (form.newPassword.value !== form.confirmPassword.value) {
    showFieldErrors(form, [{ field: 'confirmPassword', message: 'Passwords do not match.' }]);
    return;
  }

  setBusy(submitButton, true, 'Resetting…');

  try {
    const { message } = await api('/api/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword: form.newPassword.value },
    });
    flashToast(message, 'success');
    window.location.href = '/login';
  } catch (error) {
    if (error.errors) showFieldErrors(form, error.errors);
    else if (error.message.includes('invalid or has expired')) {
      form.hidden = true;
      document.querySelector('#invalid-note').hidden = false;
    }
    showToast(error.message, 'error');
    setBusy(submitButton, false);
  }
});
