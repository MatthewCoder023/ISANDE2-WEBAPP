/**
 * Skeleton loading placeholders. Pages call these right before a fetch;
 * the subsequent render overwrites them. Styles live in components.css.
 */

/** Fills a tbody with shimmering placeholder rows. */
export function tableSkeleton(tbody, columns, rows = 5) {
  tbody.innerHTML = Array.from(
    { length: rows },
    () =>
      `<tr class="skeleton-row" aria-hidden="true">${Array.from(
        { length: columns },
        () => '<td><span class="skeleton skeleton-text"></span></td>'
      ).join('')}</tr>`
  ).join('');
}

/** Product-card placeholders for the catalog grid. */
export function gridSkeleton(container, count = 8) {
  container.innerHTML = Array.from(
    { length: count },
    () => `
    <div class="card product-card" aria-hidden="true">
      <div class="product-swatch skeleton" style="border-radius: 0; border-bottom: none;"></div>
      <div class="product-body">
        <span class="skeleton skeleton-text" style="width: 42%;"></span>
        <span class="skeleton skeleton-text" style="width: 85%;"></span>
        <span class="skeleton skeleton-text" style="width: 60%;"></span>
      </div>
    </div>`
  ).join('');
}

/** Stacked line placeholders (e.g. the POS product picker). */
export function listSkeleton(container, rows = 6) {
  container.innerHTML = Array.from(
    { length: rows },
    () =>
      '<div class="skeleton" aria-hidden="true" style="height: 44px; margin: 0.5rem 0;"></div>'
  ).join('');
}

/**
 * Shimmers stat/KPI values until data lands.
 * Returns a function that clears every placeholder it set.
 */
export function statSkeleton(selector = '[data-stat]') {
  const elements = [...document.querySelectorAll(selector)];
  elements.forEach((el) => el.classList.add('skeleton'));
  return () => elements.forEach((el) => el.classList.remove('skeleton'));
}
