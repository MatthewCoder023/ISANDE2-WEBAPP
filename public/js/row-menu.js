/**
 * The "⋯" action menu on a table row.
 *
 * Three text buttons per row cost more horizontal space than the data they
 * sit beside — enough, on this table, to push the last one off screen on a
 * laptop. One trigger opens the same three actions on demand.
 *
 * Positioning is fixed and measured when the menu opens, not anchored
 * inside the row: `.table-wrap` scrolls horizontally, and per spec an
 * `overflow-x` of `auto` makes the vertical axis scroll too, so any
 * absolutely-positioned child would be clipped by the container. Fixed
 * positioning escapes that. The bargain is that the menu can't follow its
 * row, so it closes when anything scrolls — which is what most menus do.
 *
 * Listeners are delegated to the container so rows can be re-rendered
 * (this table replaces its whole tbody on every load) without rebinding.
 */

let open = null; // { list, toggle }

const itemsOf = (list) => [...list.querySelectorAll('[role="menuitem"]')];

function place(list, toggle) {
  const anchor = toggle.getBoundingClientRect();
  // Measure the menu before deciding which way it opens.
  list.style.visibility = 'hidden';
  list.hidden = false;
  const { width, height } = list.getBoundingClientRect();

  // Prefer below-right of the trigger; flip when that would leave the
  // viewport, so rows near the bottom or the right edge stay usable.
  const top = anchor.bottom + height > window.innerHeight - 8 ? anchor.top - height - 4 : anchor.bottom + 4;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));

  list.style.top = `${Math.max(8, top)}px`;
  list.style.left = `${left}px`;
  list.style.visibility = '';
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!open) return;
  const { list, toggle } = open;
  list.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  open = null;
  if (restoreFocus) toggle.focus();
}

function openMenu(toggle) {
  const list = toggle.parentElement.querySelector('[role="menu"]');
  if (!list) return;

  closeMenu();
  place(list, toggle);
  toggle.setAttribute('aria-expanded', 'true');
  open = { list, toggle };
  itemsOf(list)[0]?.focus();
}

/** Moves focus within the open menu, wrapping at both ends. */
function moveFocus(step) {
  if (!open) return;
  const items = itemsOf(open.list);
  const index = items.indexOf(document.activeElement);
  const next = (index + step + items.length) % items.length;
  items[next]?.focus();
}

/**
 * @param {HTMLElement} container element containing the rows (e.g. a tbody)
 */
export function initRowMenus(container) {
  if (!container || container.dataset.rowMenus === 'on') return;
  container.dataset.rowMenus = 'on';

  container.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-menu-toggle]');
    if (toggle) {
      event.stopPropagation();
      if (open && open.toggle === toggle) closeMenu({ restoreFocus: true });
      else openMenu(toggle);
      return;
    }
    // Choosing an action closes the menu; the page's own delegated
    // [data-action] handler still receives the click as normal.
    if (event.target.closest('[role="menuitem"]')) closeMenu();
  });

  container.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    } else if (event.key === 'Tab') {
      // Tabbing out of a menu should dismiss it rather than leave it
      // hanging over content the user has moved on from.
      closeMenu();
    }
  });
}

// A menu pinned to viewport coordinates would drift away from its row, so
// any scroll or resize dismisses it instead. Capture phase catches scrolls
// inside the table wrapper as well as the page.
document.addEventListener('click', () => closeMenu());
window.addEventListener('scroll', () => closeMenu(), true);
window.addEventListener('resize', () => closeMenu());
