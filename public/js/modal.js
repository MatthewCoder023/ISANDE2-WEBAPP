/**
 * Modal controller for markup following the pattern:
 *   <div class="modal-backdrop" id="my-modal" hidden>
 *     <div class="modal" role="dialog" aria-modal="true"> … </div>
 *   </div>
 * Close triggers: backdrop click, Escape, any [data-modal-close] element.
 *
 * Accessibility: while a modal is open, keyboard focus is trapped inside
 * it (Tab and Shift+Tab cycle through its controls), focus moves to the
 * dialog on open, and returns to whatever had it on close.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * @param backdropEl the .modal-backdrop element
 * @param onClose optional: called after any close — the × , a
 *        [data-modal-close] control, Escape, or a backdrop click. Lets a
 *        caller treat "dismissed" and "finished" as the same event without
 *        having to bind each of those routes itself.
 */
export function initModal(backdropEl, { onClose } = {}) {
  const dialog = backdropEl.querySelector('.modal');
  // Focusable fallback so screen readers announce the dialog on open.
  if (dialog && !dialog.hasAttribute('tabindex')) {
    dialog.setAttribute('tabindex', '-1');
  }

  let previouslyFocused = null;

  /** Visible, tabbable controls inside the dialog (hidden sections excluded). */
  function focusables() {
    return [...backdropEl.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
      (el) => el.offsetParent !== null
    );
  }

  function open() {
    previouslyFocused = document.activeElement;
    backdropEl.hidden = false;
    document.body.style.overflow = 'hidden';
    (dialog || focusables()[0])?.focus();
  }

  function close() {
    // Guard against the double-fire an already-closed modal would cause:
    // Escape while hidden, or a [data-modal-close] control clicked twice.
    if (backdropEl.hidden) return;

    backdropEl.hidden = true;
    document.body.style.overflow = '';
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
    onClose?.();
  }

  backdropEl.addEventListener('click', (event) => {
    if (event.target === backdropEl) close();
  });

  backdropEl.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', (event) => {
    if (backdropEl.hidden) return;

    if (event.key === 'Escape') {
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !backdropEl.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !backdropEl.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });

  return { open, close, el: backdropEl };
}
