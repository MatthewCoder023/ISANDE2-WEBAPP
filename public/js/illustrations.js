/**
 * Line-art illustrations for empty states. Hand-authored SVG rather than a
 * blown-up icon: an empty screen is a moment with nothing to look at, so it
 * is worth a drawing with some personality. Strokes inherit currentColor;
 * the accent shape (paint in the can, a filled chip) picks up the brand
 * colour, so both themes work without overrides.
 *
 * Usage: <div class="empty-state-icon" data-illustration="no-orders"></div>
 * filled in by hydrateIllustrations(), the same pattern as icons.js.
 */

const frame = (contents) =>
  `<svg viewBox="0 0 120 92" width="120" height="92" fill="none" stroke="currentColor"` +
  ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${contents}</svg>`;

const ILLUSTRATIONS = {
  /* Nothing matched a search or filter: chips under a magnifier. */
  'no-results': frame(`
    <rect x="16" y="52" width="20" height="20" rx="4" fill="var(--primary-500)" fill-opacity="0.16"/>
    <rect x="42" y="52" width="20" height="20" rx="4"/>
    <rect x="68" y="52" width="20" height="20" rx="4"/>
    <circle cx="70" cy="34" r="17"/>
    <path d="M82 46.5 96 60"/>
  `),

  /* No orders yet: an open, empty box. */
  'no-orders': frame(`
    <path d="M26 44h68v36a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4z"/>
    <path d="M26 44 14 28h34l-6 16"/>
    <path d="M94 44l12-16H72l6 16"/>
    <path d="M52 58h16" stroke-opacity="0.55"/>
  `),

  /* Cart with nothing in it — a droplet waiting to be added. */
  'empty-cart': frame(`
    <path d="M14 20h10l11 38h46l9-26H33"/>
    <circle cx="44" cy="74" r="6"/>
    <circle cx="78" cy="74" r="6"/>
    <path d="M60 12c4 5 7 8 7 12a7 7 0 0 1-14 0c0-4 3-7 7-12z" fill="var(--primary-500)" fill-opacity="0.16"/>
  `),

  /* No custom mixes: a paint can and brush. */
  'no-mixes': frame(`
    <path d="M36 60h40v18a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4z" fill="var(--primary-500)" fill-opacity="0.16"/>
    <path d="M36 38h40v40a4 4 0 0 1-4 4H40a4 4 0 0 1-4-4z"/>
    <ellipse cx="56" cy="38" rx="20" ry="7"/>
    <path d="M36 50c-7 0-11 5-11 11"/>
    <path d="M86 16l12 12-19 19-12-12z"/>
    <path d="M74 40 63 51"/>
  `),

  /* No history: a sheet with a folded corner and a few ruled lines. */
  'no-history': frame(`
    <path d="M30 12h44l16 16v52a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z"/>
    <path d="M74 12v16h16" fill="var(--primary-500)" fill-opacity="0.16"/>
    <path d="M40 46h30"/>
    <path d="M40 58h34"/>
    <path d="M40 70h20"/>
  `),
};

export function illustration(name) {
  return ILLUSTRATIONS[name] || '';
}

/** Fills every <div data-illustration="name"> with its drawing. */
export function hydrateIllustrations(root = document) {
  root.querySelectorAll('[data-illustration]').forEach((el) => {
    el.innerHTML = illustration(el.dataset.illustration);
  });
}
