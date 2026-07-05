/**
 * Modal controller for markup following the pattern:
 *   <div class="modal-backdrop" id="my-modal" hidden>
 *     <div class="modal" role="dialog" aria-modal="true"> … </div>
 *   </div>
 * Close triggers: backdrop click, Escape, any [data-modal-close] element.
 */
export function initModal(backdropEl) {
  function open() {
    backdropEl.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    backdropEl.hidden = true;
    document.body.style.overflow = '';
  }

  backdropEl.addEventListener('click', (event) => {
    if (event.target === backdropEl) close();
  });

  backdropEl.querySelectorAll('[data-modal-close]').forEach((el) => {
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdropEl.hidden) close();
  });

  return { open, close, el: backdropEl };
}
