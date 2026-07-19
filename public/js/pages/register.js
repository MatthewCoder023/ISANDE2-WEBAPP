import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { addPasswordToggle, addPasswordChecklist } from '/js/password-ui.js';

const form = document.querySelector('#register-form');
addPasswordToggle(form.password);
addPasswordToggle(form.confirmPassword);
addPasswordChecklist(form.password);
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);

  if (form.password.value !== form.confirmPassword.value) {
    showFieldErrors(form, [
      { field: 'confirmPassword', message: 'Passwords do not match.' },
    ]);
    return;
  }

  setBusy(submitButton, true, 'Creating account…');

  try {
    const { data } = await api('/api/auth/register', {
      method: 'POST',
      body: {
        firstName: form.firstName.value,
        lastName: form.lastName.value,
        email: form.email.value,
        phone: form.phone.value,
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
