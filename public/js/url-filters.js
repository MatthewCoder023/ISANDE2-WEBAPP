/**
 * Seeds a list page's filters from the URL query string, so a deep link
 * (a dashboard stat tile, a bookmark, a shared link) opens the exact view
 * it advertises instead of the unfiltered default.
 *
 * Usage — pass { queryParam: selectSelector } and merge the result into
 * the page's state before the first load:
 *
 *   Object.assign(state, applyUrlFilters({ status: '#status-filter' }));
 *
 * Values are accepted only when the <select> actually offers them, so a
 * junk or stale link falls back to the default and the control never
 * disagrees with the state it drives.
 */
export function applyUrlFilters(map) {
  const params = new URLSearchParams(window.location.search);
  const applied = {};

  for (const [param, selector] of Object.entries(map)) {
    const value = params.get(param);
    if (value === null) continue;

    const control = document.querySelector(selector);
    if (!control || !control.options) continue;
    if (![...control.options].some((option) => option.value === value)) continue;

    control.value = value;
    applied[param] = value;
  }

  return applied;
}
