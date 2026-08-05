/**
 * The line under a stat figure: what it's doing compared with the period
 * before it.
 *
 * A number on its own is a fact; against the previous period it's a
 * direction, which is the thing anyone actually wants from a dashboard.
 *
 * The awkward case is a previous period of zero. There is no percentage to
 * report — "up ∞%" is noise, and "up 100%" is a lie — so those tiles say
 * what genuinely happened instead of manufacturing a figure.
 */
import { escapeHtml } from '/js/format.js';
import { icon } from '/js/icons.js';

/** Rounds toward a whole percent, treating a hair either side of 0 as flat. */
function direction(percent) {
  if (percent >= 0.5) return 'up';
  if (percent <= -0.5) return 'down';
  return 'flat';
}

/**
 * From the icon set rather than the arrow characters this used to print:
 * "↑" renders in whatever fallback font the system picks, which on Windows
 * is visibly not Inter and sits at the wrong weight beside the figure.
 */
const ARROW = { up: icon('arrow-up', 12), down: icon('arrow-down', 12), flat: '' };

/**
 * @param {number} current
 * @param {number} previous
 * @param {string} periodLabel  e.g. "same point last month"
 * @param {object} [options]
 * @param {boolean} [options.lowerIsBetter]  for figures where a fall is good
 * @returns {string} HTML for the .stat-meta slot
 */
export function deltaMarkup(current, previous, periodLabel, { lowerIsBetter = false } = {}) {
  const period = escapeHtml(periodLabel);

  // Every branch ends "vs <period>", so the chip carries the whole message
  // and the sentence stays grammatical whichever branch is taken.
  const line = (tone, text) =>
    `<span class="stat-delta is-${tone}">${text}</span><span>vs ${period}</span>`;

  if (!previous) {
    // Nothing to divide by: state what happened rather than invent a ratio.
    return current ? line('up', 'New') : line('flat', 'Nothing');
  }

  const percent = ((current - previous) / previous) * 100;
  const move = direction(percent);
  // Colour follows whether the move is *good*, not whether it points up:
  // a rise in stock alerts is not a success.
  const tone = move === 'flat' ? 'flat' : (move === 'up') !== lowerIsBetter ? 'up' : 'down';

  return line(tone, `${ARROW[move]}${Math.abs(Math.round(percent))}%`);
}

/** Writes a comparison line into the tile that owns `key`. */
export function setMeta(key, html) {
  const el = document.querySelector(`[data-meta="${key}"]`);
  if (el) el.innerHTML = html;
}
