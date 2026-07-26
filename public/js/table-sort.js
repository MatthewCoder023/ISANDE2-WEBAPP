/**
 * Click-to-sort for server-paged tables.
 *
 * Sorting has to happen on the server — a page shows ten of hundreds of
 * rows, so reordering what's on screen would be a lie. This wires the
 * headers, reports the chosen key back, and keeps `aria-sort` truthful so
 * the announced direction matches the data.
 *
 * Markup, naming each direction explicitly so the label can't drift from
 * the ordering:
 *
 *   <th data-sort-asc="total_asc" data-sort-desc="total_desc"
 *       data-sort-default="desc">Total</th>
 *
 * A column with only one sensible order (a status, say) needs only
 * `data-sort-asc`.
 */

const keysOf = (th) => ({
  asc: th.dataset.sortAsc || '',
  desc: th.dataset.sortDesc || '',
});

/**
 * @param {HTMLElement} thead
 * @param {(sortKey: string) => void} onSort
 * @returns {(current: string) => void} paints aria-sort for the active key
 */
export function initTableSort(thead, onSort) {
  if (!thead) return () => {};

  const headers = [...thead.querySelectorAll('th[data-sort-asc], th[data-sort-desc]')];

  for (const th of headers) {
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');

    const activate = () => {
      const { asc, desc } = keysOf(th);
      const state = th.getAttribute('aria-sort');

      // Re-clicking the active column flips it; a new column opens in its
      // natural direction (dates and money read best largest-first).
      let next;
      if (state === 'ascending') next = desc || asc;
      else if (state === 'descending') next = asc || desc;
      else next = th.dataset.sortDefault === 'desc' ? desc || asc : asc || desc;

      if (next) onSort(next);
    };

    th.addEventListener('click', activate);
    th.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
  }

  return function paint(current) {
    for (const th of headers) {
      const { asc, desc } = keysOf(th);
      if (current && current === asc) th.setAttribute('aria-sort', 'ascending');
      else if (current && current === desc) th.setAttribute('aria-sort', 'descending');
      else th.removeAttribute('aria-sort');
    }
  };
}
