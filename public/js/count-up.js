/**
 * Rolls a number up to its final value so dashboard figures land with a
 * little life instead of appearing fully formed. The formatter is passed
 * in, so currency tiles keep their ₱ and grouping while counting.
 *
 * Users who ask for less motion get the final value immediately — the
 * number is the point, the animation is decoration.
 */

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const DURATION = 650;

/** Ease-out cubic: fast start, gentle settle. */
const ease = (t) => 1 - (1 - t) ** 3;

export function countUp(el, to, format = (n) => String(n)) {
  if (!el) return;

  const target = Number(to);
  if (!Number.isFinite(target)) {
    el.textContent = to; // not a number (e.g. an em dash) — show it as-is
    return;
  }

  const settle = () => {
    el.textContent = format(target);
  };

  /**
   * Skip the animation when motion is unwelcome, there is nothing to count,
   * or the page is hidden — browsers pause requestAnimationFrame in
   * background tabs, and a number that never arrives is far worse than a
   * missing flourish.
   */
  if (REDUCED_MOTION.matches || target === 0 || document.hidden) {
    settle();
    return;
  }

  // Should the tab be backgrounded mid-count, snap to the final value rather
  // than freezing part-way there.
  let running = true;
  const stopEarly = () => {
    if (!running) return;
    running = false;
    settle();
  };
  document.addEventListener('visibilitychange', stopEarly, { once: true });

  const start = performance.now();
  const step = (now) => {
    if (!running) return;
    const progress = Math.min((now - start) / DURATION, 1);
    const value = target * ease(progress);
    // Integers count in whole steps; money keeps its decimals.
    el.textContent = format(Number.isInteger(target) ? Math.round(value) : value);

    if (progress < 1) {
      requestAnimationFrame(step);
      return;
    }
    running = false;
    document.removeEventListener('visibilitychange', stopEarly);
    settle();
  };
  requestAnimationFrame(step);
}
