/**
 * Shared helpers for form pages: field-level error display and
 * submit-button busy state.
 */

/** Shows API validation errors ({ field, message }[]) under matching inputs. */
export function showFieldErrors(form, errors = []) {
  clearFieldErrors(form);
  for (const { field, message } of errors) {
    const input = form.querySelector(`[name="${field}"]`);
    if (!input) continue;
    input.classList.add('is-invalid');
    const errorEl = form.querySelector(`[data-error-for="${field}"]`);
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add('is-visible');
    }
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  form.querySelectorAll('.form-error.is-visible').forEach((el) => {
    el.textContent = '';
    el.classList.remove('is-visible');
  });
}

/** Disables the button and swaps its label while an async action runs. */
export function setBusy(button, busy, busyLabel = 'Please wait…') {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}
