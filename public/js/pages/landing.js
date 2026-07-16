/**
 * Landing page: reveals sections as they scroll into view, and hosts
 * a theme toggle in the header. Elements marked [data-reveal] start
 * hidden (see components.css) and fade up once; users with reduced
 * motion see everything immediately.
 */
import { icon } from '/js/icons.js';

const nav = document.querySelector('.site-header-inner nav');
if (nav) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle-round';
  const render = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    button.innerHTML = icon(dark ? 'sun' : 'moon', 17);
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  render();
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('fc_theme', next);
    } catch {
      /* private mode */
    }
    render();
  });
  nav.prepend(button);
}

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
