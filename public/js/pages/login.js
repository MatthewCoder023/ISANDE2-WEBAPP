/**
 * Shared by the customer login and employee login pages —
 * both submit to the same endpoint; the server decides the
 * destination dashboard from the authenticated user's role.
 */
import { api } from '/js/api.js';
import { showToast, showFlashToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { addPasswordToggle } from '/js/password-ui.js';

const form = document.querySelector('#login-form');
addPasswordToggle(form.password);
showFlashToast(); // e.g. "Password reset" confirmation after the redirect
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  setBusy(submitButton, true, 'Signing in…');

  try {
    const { data } = await api('/api/auth/login', {
      method: 'POST',
      body: {
        email: form.email.value,
        password: form.password.value,
      },
    });
    window.location.assign(data.redirectTo);
  } catch (error) {
    if (error.errors) showFieldErrors(form, error.errors);
    showToast(error.message, 'error');
    setBusy(submitButton, false);
  }
});
