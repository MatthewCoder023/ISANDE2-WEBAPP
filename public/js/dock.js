/**
 * Floating navigation dock — the shell's primary navigation on every
 * authenticated page.
 *
 * It replaces a 250px sidebar that was permanently on screen for the sake of
 * five to nine links. The dense pages are the ones that suffer from that:
 * the orders table, the POS, the products grid all want horizontal room, and
 * a dock gives back the whole column while keeping every destination one
 * click away.
 *
 * Three rules shape it:
 *
 * 1. Destinations come from dockGroupsFor(), which filters against the same
 *    per-role allow-list the server enforces. The dock can never offer a
 *    page the role would be refused.
 * 2. The account controls — user card, theme toggle, Sign Out — live in the
 *    dock's own menu under the same selectors the rest of the shell already
 *    binds to (#logout-btn, .dash-user, .theme-toggle), so nothing that used
 *    to reach into the sidebar had to learn a new name.
 * 3. Magnification and tooltips are CSS. Only the menus need JavaScript, and
 *    only for what CSS genuinely cannot do: open state, focus management,
 *    and keeping a menu inside the viewport.
 *
 * The menus are ordinary popups rather than modals: they never trap focus,
 * and anything that takes focus elsewhere closes them.
 */
import { icon } from '/js/icons.js';
import { escapeHtml } from '/js/format.js';
import { dockGroupsFor } from '/js/nav.js';

let dock = null;
let openItem = null;
let openMenu = null;

/* ---------- Open / close ---------- */

/** The whole element, so a click on the tile's <svg> still counts as inside. */
const itemOf = (node) => (node instanceof Node ? node.closest?.('.dock-item') : null);

/** A menu no longer lives inside its tile — see relocateMenus(). */
const insideOpenMenu = (node) =>
  Boolean(openItem && (openItem.contains(node) || openMenu?.contains(node)));

function closeMenu({ restoreFocus = false } = {}) {
  if (!openItem) return;
  const item = openItem;
  openItem = null;
  openMenu?.classList.remove('is-open');
  openMenu = null;
  item.classList.remove('is-open');
  item.querySelector('.dock-tile')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) item.querySelector('.dock-tile')?.focus();
}

/**
 * Menus are centred over their tile and clamped to the viewport, both in
 * fixed coordinates because they hang off the end of the document rather
 * than inside the dock. Phones override the horizontal half in CSS, where
 * the menu spans the screen instead.
 */
function positionMenu(item, menu) {
  const tile = item.querySelector('.dock-tile').getBoundingClientRect();
  const margin = 8;

  // offsetWidth rather than a bounding box: the menu is mid-transition from
  // scale(0.96) at this point, so its rendered box is a few pixels narrow
  // and would under-report the overflow. Layout width has no such problem.
  const width = menu.offsetWidth;
  const centred = tile.left + tile.width / 2 - width / 2;
  const left = Math.min(Math.max(margin, centred), window.innerWidth - width - margin);

  menu.style.setProperty('--menu-left', `${left}px`);
  menu.style.setProperty('--menu-bottom', `${window.innerHeight - tile.top + 10}px`);
}

function showMenu(item, { focusFirst = false } = {}) {
  if (openItem === item) return closeMenu({ restoreFocus: true });
  closeMenu();

  const menu = menuFor(item);
  if (!menu) return;

  openItem = item;
  openMenu = menu;
  item.classList.add('is-open');
  item.querySelector('.dock-tile')?.setAttribute('aria-expanded', 'true');

  positionMenu(item, menu);
  menu.classList.add('is-open');
  if (focusFirst) menu.querySelector('[data-menu-item]')?.focus();
}

/* ---------- Menu placement ---------- */

const menuFor = (item) => document.querySelector(`[data-dock-menu="${item.dataset.dock}"]`);

/**
 * Menus are built inside their tile — that is the only place their content
 * makes sense — and then lifted out to <body>.
 *
 * They have to leave. The dock carries a backdrop-filter, and a filtered
 * element becomes the backdrop root for everything inside it: a descendant's
 * own backdrop-filter can then only sample the dock, which the menu sits
 * above and outside. The frosting silently does nothing, and the page shows
 * through the tint. Out at <body> the menus have the page itself to blur,
 * which is what makes them read as glass.
 */
function relocateMenus() {
  dock.querySelectorAll('.dock-item').forEach((item, index) => {
    item.dataset.dock = index;
    const menu = item.querySelector('.dock-menu');
    if (!menu) return;
    menu.dataset.dockMenu = index;
    document.body.appendChild(menu);
  });
}

/* ---------- Markup ---------- */

/**
 * A tile is a link when it only goes one place and a button when it opens a
 * menu — the element carries the behaviour rather than a role attribute
 * papering over the wrong one.
 */
function tileMarkup(group) {
  const glyph = icon(group.icon, 22);
  const label = escapeHtml(group.label);

  if (group.items.length > 0) {
    return (
      `<button type="button" class="dock-tile" aria-haspopup="true" aria-expanded="false"` +
      ` aria-label="${label}">${glyph}</button>`
    );
  }
  return `<a href="${group.href}" class="dock-tile" aria-label="${label}">${glyph}</a>`;
}

function menuMarkup(group, currentUrl) {
  const links = group.items
    .map((item) => {
      // Matched on the full URL, filters included, so an open Orders menu
      // shows which of its views you are actually looking at.
      const current = item.href === currentUrl;
      return (
        `<a href="${item.href}" class="dock-menu-item${current ? ' is-current' : ''}" data-menu-item>` +
        `<span>${escapeHtml(item.label)}</span>${current ? icon('check', 15) : ''}</a>`
      );
    })
    .join('');

  // Deliberately not role="menu": these are lists of links, and the account
  // one also holds a user card and a toggle. A real menu would make every
  // one of those an invalid child for the sake of a role that buys nothing —
  // the arrow keys below work regardless.
  return (
    `<div class="dock-menu" aria-label="${escapeHtml(group.label)}">` +
    `<p class="dock-menu-title">${escapeHtml(group.label)}</p>${links}</div>`
  );
}

function groupMarkup(group, currentPath, currentUrl) {
  /**
   * A tile owns the page it points at, filters and all — so Orders stays lit
   * on /orders?status=ready.
   *
   * Menus are explicitly not consulted here. Several of them cross into
   * another module's pages (POS offers "Walk-in Sales", which is the orders
   * table), and counting those would light two tiles at once and leave the
   * dock saying you are in two places. A container tile like "More", which
   * has no page of its own, is the one case that has to look at its items.
   */
  const pathOf = (href) => new URL(href, window.location.origin).pathname;
  const owns = group.href
    ? pathOf(group.href) === currentPath
    : group.items.some((item) => pathOf(item.href) === currentPath);
  const active = owns ? ' is-active' : '';

  return (
    `<div class="dock-item${active}">${tileMarkup(group)}` +
    `<span class="dock-tip" aria-hidden="true">${escapeHtml(group.label)}</span>` +
    (group.items.length > 0 ? menuMarkup(group, currentUrl) : '') +
    '</div>'
  );
}

/**
 * The account menu. The theme toggle is not built here — dashboard.js still
 * owns it and inserts it into .dock-account-menu, exactly as it used to
 * insert it into the sidebar footer.
 */
function accountMarkup(currentPath) {
  const active = currentPath === '/profile' ? ' is-active' : '';
  return (
    `<span class="dock-divider" aria-hidden="true"></span>` +
    `<div class="dock-item dock-item--account${active}">` +
    `<button type="button" class="dock-tile dock-tile--account" aria-haspopup="true"` +
    ` aria-expanded="false" aria-label="Account">` +
    `<span class="dock-avatar" data-user-initials></span></button>` +
    `<span class="dock-tip" aria-hidden="true">Account</span>` +
    `<div class="dock-menu dock-account-menu" aria-label="Account">` +
    `<div class="dash-user">` +
    `<span class="dash-user-avatar" data-user-initials></span>` +
    `<div><div class="dash-user-name" data-user-name></div>` +
    `<div class="dash-user-role" data-user-role></div></div></div>` +
    `<a href="/profile" class="dock-menu-item" data-menu-item>My Profile</a>` +
    `<button type="button" id="logout-btn" class="btn-logout" data-menu-item>` +
    `${icon('log-out', 15)} <span>Sign Out</span></button>` +
    '</div></div>'
  );
}

/* ---------- Keyboard ---------- */

const tiles = () => [...dock.querySelectorAll('.dock-tile')];

/** Roving arrow keys along the dock, the way a toolbar behaves. */
function moveTile(from, delta) {
  const all = tiles();
  const index = all.indexOf(from);
  if (index === -1) return;
  const next = all[(index + delta + all.length) % all.length];
  closeMenu();
  next.focus();
}

function onTileKeydown(event, tile) {
  const item = itemOf(tile);
  const hasMenu = Boolean(menuFor(item));

  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault();
      moveTile(tile, 1);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      moveTile(tile, -1);
      break;
    case 'Home':
      event.preventDefault();
      closeMenu();
      tiles()[0]?.focus();
      break;
    case 'End':
      event.preventDefault();
      closeMenu();
      tiles().at(-1)?.focus();
      break;
    case 'ArrowUp':
      // Up is toward the menu — the menu sits above the dock.
      if (!hasMenu) break;
      event.preventDefault();
      showMenu(item, { focusFirst: true });
      break;
    case 'Escape':
      closeMenu({ restoreFocus: true });
      break;
    default:
      break;
  }
}

function onMenuKeydown(event) {
  const entries = [...openMenu.querySelectorAll('[data-menu-item]')];
  const index = entries.indexOf(document.activeElement);

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      entries[(index + 1) % entries.length]?.focus();
      break;
    case 'ArrowUp':
      event.preventDefault();
      entries[(index - 1 + entries.length) % entries.length]?.focus();
      break;
    case 'Home':
      event.preventDefault();
      entries[0]?.focus();
      break;
    case 'End':
      event.preventDefault();
      entries.at(-1)?.focus();
      break;
    case 'Escape':
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      break;
    case 'Tab':
      // Not a modal: let Tab leave, but don't leave a menu hanging open
      // over the page behind it.
      closeMenu();
      break;
    default:
      break;
  }
}

/* ---------- Mount ---------- */

export function setupDock(role) {
  if (document.querySelector('.dock')) return;

  const currentPath = window.location.pathname;
  const currentUrl = currentPath + window.location.search;
  const groups = dockGroupsFor(role);

  const wrap = document.createElement('div');
  wrap.className = 'dock-wrap';
  wrap.innerHTML =
    '<nav class="dock" aria-label="Main navigation">' +
    groups.map((group) => groupMarkup(group, currentPath, currentUrl)).join('') +
    accountMarkup(currentPath) +
    '</nav>';
  document.body.appendChild(wrap);

  dock = wrap.querySelector('.dock');
  relocateMenus();

  // One tab stop for the whole dock, arrows for the rest — the toolbar
  // pattern. Landing on the current page's tile is the useful default.
  const tabTarget =
    dock.querySelector('.dock-item.is-active .dock-tile') || dock.querySelector('.dock-tile');
  tiles().forEach((tile) => {
    tile.tabIndex = tile === tabTarget ? 0 : -1;
  });

  dock.addEventListener('click', (event) => {
    const tile = event.target.closest?.('.dock-tile');
    if (!tile) return;
    const item = itemOf(tile);
    if (!menuFor(item)) return; // plain link — let it navigate
    event.preventDefault();
    showMenu(item);
  });

  dock.addEventListener('focusin', (event) => {
    const tile = event.target.closest?.('.dock-tile');
    if (!tile) return;
    tiles().forEach((other) => {
      other.tabIndex = other === tile ? 0 : -1;
    });
  });

  dock.addEventListener('keydown', (event) => {
    const tile = event.target.closest?.('.dock-tile');
    if (tile) onTileKeydown(event, tile);
  });

  // Menus are siblings of the dock at <body> level now, so their keys are
  // caught here rather than by the dock's own listener.
  document.addEventListener('keydown', (event) => {
    if (openMenu && event.target.closest?.('.dock-menu')) onMenuKeydown(event);
  });

  // Anything that happens outside an open menu dismisses it — a click on the
  // page, Escape from anywhere, or focus moving away (which is how the
  // command palette gets a clean screen when it opens over the dock).
  document.addEventListener('pointerdown', (event) => {
    if (openItem && !insideOpenMenu(event.target)) closeMenu();
  });
  document.addEventListener('focusin', (event) => {
    if (openItem && !insideOpenMenu(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openItem) closeMenu({ restoreFocus: true });
  });
  window.addEventListener('resize', () => closeMenu());
}
