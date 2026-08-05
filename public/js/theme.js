/**
 * Applies saved display preferences BEFORE first paint, so pages never
 * flash the wrong mode or a sidebar that immediately collapses. Loaded as
 * a classic (render-blocking) script in <head> — an external file, so the
 * production CSP stays untouched.
 *
 * Theme precedence: saved choice > operating-system preference > light.
 * The invoice page intentionally omits this script (print documents
 * stay light, and have no sidebar).
 */
(function () {
  var read = function (key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null; /* private mode — fall back to defaults */
    }
  };

  var stored = read('fc_theme');
  var theme =
    stored ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  document.documentElement.dataset.theme = theme;

  // Stamped on the root rather than the layout because this runs before
  // <body> exists; the CSS keys the rail off the root attribute.
  if (read('fc_rail') === '1') {
    document.documentElement.dataset.rail = '1';
  }
})();
