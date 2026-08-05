/**
 * Command palette — ⌘K (Ctrl+K on Windows/Linux).
 *
 * Nine sidebar destinations plus the account controls is more than anyone
 * wants to hunt through with a mouse, and staff move between the same few
 * screens all day. Typing two letters and pressing Enter is faster than any
 * amount of navigation design.
 *
 * Two rules shape it:
 *
 * 1. Destinations come from the same per-role config the dock is built from,
 *    so the palette can never surface a page the server would refuse. It is
 *    a faster route to what you already have, never a way to discover more.
 *    That includes the dock's filtered views, which is where the palette
 *    earns its keep: "ready" reaches Orders — Ready for Pickup in one line,
 *    where the dock needs a click and then a choice.
 * 2. Actions delegate to the real controls in the dock rather than
 *    reimplementing them, so toggling the theme from here and toggling it
 *    from the button can't drift apart.
 *
 * Focus stays in the input and the active option is tracked with
 * aria-activedescendant — the standard combobox arrangement, and the reason
 * arrow keys can move a selection without stealing focus from what you type.
 */
import { icon } from '/js/icons.js';
import { escapeHtml } from '/js/format.js';
import { dockDestinations } from '/js/nav.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

let items = [];
let matches = [];
let activeIndex = 0;
let previouslyFocused = null;

const els = {};

/** Actions delegate to the controls already in the shell — see rule 2. */
function actionItems() {
  const dark = document.documentElement.dataset.theme === 'dark';

  return [
    {
      group: 'Actions',
      label: dark ? 'Switch to light mode' : 'Switch to dark mode',
      keywords: 'theme dark light appearance',
      icon: dark ? 'sun' : 'moon',
      run: () => document.querySelector('.theme-toggle')?.click(),
    },
    {
      group: 'Actions',
      label: 'Sign out',
      keywords: 'logout log out leave exit',
      icon: 'log-out',
      run: () => document.querySelector('#logout-btn')?.click(),
    },
  ];
}

function buildItems(role) {
  const destinations = dockDestinations(role).map((item) => ({
    group: 'Go to',
    label: item.label,
    keywords: item.href,
    icon: item.icon,
    run: () => window.location.assign(item.href),
  }));
  return [...destinations, ...actionItems()];
}

/**
 * Substring match over the label and its keywords. Deliberately not fuzzy:
 * on a list this short, subsequence matching mostly produces surprising
 * hits ("sos" matching "Point of Sale") for no real gain.
 */
function filter(query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  return items
    .map((item) => {
      const label = item.label.toLowerCase();
      const haystack = `${label} ${item.keywords || ''}`.toLowerCase();
      if (!haystack.includes(q)) return null;
      // A label that starts with what you typed is what you meant.
      return { item, rank: label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2 };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank)
    .map((m) => m.item);
}

function renderList() {
  if (matches.length === 0) {
    els.list.innerHTML = '<p class="cmdk-empty">No matches.</p>';
    els.input.removeAttribute('aria-activedescendant');
    return;
  }

  let lastGroup = null;
  els.list.innerHTML = matches
    .map((item, i) => {
      const heading =
        item.group === lastGroup ? '' : `<p class="cmdk-group">${escapeHtml(item.group)}</p>`;
      lastGroup = item.group;
      return (
        heading +
        `<div class="cmdk-item${i === activeIndex ? ' is-active' : ''}" role="option"` +
        ` id="cmdk-opt-${i}" aria-selected="${i === activeIndex}" data-index="${i}">` +
        `<span class="cmdk-item-icon">${icon(item.icon, 16)}</span>` +
        `<span>${escapeHtml(item.label)}</span></div>`
      );
    })
    .join('');

  els.input.setAttribute('aria-activedescendant', `cmdk-opt-${activeIndex}`);
  els.list.querySelector('.cmdk-item.is-active')?.scrollIntoView({ block: 'nearest' });
}

function setActive(index) {
  if (matches.length === 0) return;
  // Wraps, so holding ↓ cycles rather than stalling at the bottom.
  activeIndex = (index + matches.length) % matches.length;
  renderList();
}

const isOpen = () => !els.backdrop.hidden;

/**
 * A modal is a deliberate, focused task — an edit form mid-entry, a stock
 * adjustment — and it stacks above this panel. Opening the palette from
 * inside one would put an invisible input behind the dialog and quietly
 * eat every keystroke, so the shortcut stands down while one is up.
 */
const modalIsOpen = () => Boolean(document.querySelector('.modal-backdrop:not([hidden])'));

function open() {
  if (isOpen() || modalIsOpen()) return;
  previouslyFocused = document.activeElement;
  // Rebuilt on open so the action labels reflect the current theme rather
  // than whatever it was at page load.
  items = buildItems(els.backdrop.dataset.role);
  els.input.value = '';
  matches = items;
  activeIndex = 0;
  els.backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  renderList();
  els.input.focus();
}

function close() {
  if (!isOpen()) return;
  els.backdrop.hidden = true;
  document.body.style.overflow = '';
  if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  previouslyFocused = null;
}

function activate() {
  const item = matches[activeIndex];
  if (!item) return;
  close();
  item.run();
}

function markup() {
  const hint = isMac ? '⌘K' : 'Ctrl K';
  return `
    <div class="cmdk-backdrop" id="cmdk" hidden>
      <div class="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdk-search">
          <span class="cmdk-search-icon">${icon('search', 17)}</span>
          <input type="text" id="cmdk-input" class="cmdk-input" role="combobox"
                 aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list"
                 placeholder="Search pages and actions…" autocomplete="off" spellcheck="false" />
          <kbd class="cmdk-kbd">esc</kbd>
        </div>
        <div class="cmdk-list" id="cmdk-list" role="listbox" aria-label="Results"></div>
        <div class="cmdk-foot">
          <span><kbd class="cmdk-kbd">↑</kbd><kbd class="cmdk-kbd">↓</kbd> to move</span>
          <span><kbd class="cmdk-kbd">↵</kbd> to open</span>
          <span class="cmdk-foot-spacer"></span>
          <span><kbd class="cmdk-kbd">${hint}</kbd> anywhere</span>
        </div>
      </div>
    </div>`;
}

/** Topbar affordance, so the shortcut is discoverable without being known. */
function trigger() {
  const hint = isMac ? '⌘K' : 'Ctrl K';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cmdk-trigger';
  button.innerHTML = `${icon('search', 15)} <span>Search</span> <kbd class="cmdk-kbd">${hint}</kbd>`;
  button.setAttribute('aria-label', 'Open the command palette');
  button.addEventListener('click', open);
  return button;
}

export function setupCommandPalette(role) {
  if (document.querySelector('#cmdk')) return;

  document.body.insertAdjacentHTML('beforeend', markup());
  els.backdrop = document.querySelector('#cmdk');
  els.input = document.querySelector('#cmdk-input');
  els.list = document.querySelector('#cmdk-list');
  els.backdrop.dataset.role = role;

  // Sits before the notification bell, or last if this page has none.
  // Written as a plain branch: `before()` returns undefined, so chaining it
  // with `??` runs the fallback every time and inserts a second trigger.
  const topbar = document.querySelector('.dash-topbar');
  if (topbar) {
    const bell = topbar.querySelector('[data-notif]');
    if (bell) bell.before(trigger());
    else topbar.append(trigger());
  }

  els.input.addEventListener('input', () => {
    matches = filter(els.input.value);
    activeIndex = 0;
    renderList();
  });

  els.list.addEventListener('click', (event) => {
    const el = event.target.closest('.cmdk-item');
    if (!el) return;
    activeIndex = Number(el.dataset.index);
    activate();
  });

  // Hovering should preview what Enter would do.
  els.list.addEventListener('pointermove', (event) => {
    const el = event.target.closest('.cmdk-item');
    if (el && Number(el.dataset.index) !== activeIndex) setActive(Number(el.dataset.index));
  });

  els.backdrop.addEventListener('click', (event) => {
    if (event.target === els.backdrop) close();
  });

  document.addEventListener('keydown', (event) => {
    // Open from anywhere. Checking both modifiers keeps one binding working
    // across platforms without sniffing which one this is.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (isOpen()) close();
      else open();
      return;
    }

    if (!isOpen()) return;

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActive(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(matches.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        activate();
        break;
      case 'Tab':
        // The dialog holds one focusable control; keep it there rather than
        // letting Tab wander into the page behind.
        event.preventDefault();
        break;
      default:
        break;
    }
  });
}
