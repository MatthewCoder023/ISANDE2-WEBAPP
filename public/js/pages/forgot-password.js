import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';

const form = document.querySelector('#forgot-form');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  setBusy(submitButton, true, 'Sending…');

  try {
    const { message } = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: form.email.value },
    });
    // The response is intentionally the same whether or not the account
    // exists — swap the form for the confirmation note either way.
    form.hidden = true;
    document.querySelector('#sent-note').hidden = false;
    showToast(message, 'success');
  } catch (error) {
    if (error.errors) showFieldErrors(form, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(submitButton, false);
  }
});
