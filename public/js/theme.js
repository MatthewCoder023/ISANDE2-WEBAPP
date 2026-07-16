/**
 * Applies the color theme BEFORE first paint so pages never flash the
 * wrong mode. Loaded as a classic (render-blocking) script in <head> —
 * an external file, so the production CSP stays untouched.
 *
 * Precedence: saved choice > operating-system preference > light.
 * The invoice page intentionally omits this script (print documents
 * stay light).
 */
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('fc_theme');
  } catch (err) {
    /* storage unavailable — fall back to the system preference */
  }
  var theme =
    stored ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light');
  document.documentElement.dataset.theme = theme;
})();
