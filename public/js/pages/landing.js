/**
 * Landing page: reveals sections as they scroll into view.
 * Elements marked [data-reveal] start hidden (see components.css) and
 * fade up once; users with reduced motion see everything immediately.
 */
const elements = document.querySelectorAll('[data-reveal]');

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  elements.forEach((el) => observer.observe(el));
} else {
  elements.forEach((el) => el.classList.add('is-revealed'));
}
