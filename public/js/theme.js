/**
 * Applies the saved theme BEFORE first paint, so pages never flash the wrong
 * mode. Loaded as a classic (render-blocking) script in <head> — an external
 * file, so the production CSP stays untouched.
 *
 * Theme precedence: saved choice > operating-system preference > light.
 * The invoice page intentionally omits this script — print documents
 * stay light.
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
})();
