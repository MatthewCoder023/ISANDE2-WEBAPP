/**
 * First-run walkthrough for the customer module.
 *
 * Shown once, on the customer dashboard, to an account that has never been
 * through it — normally the first page someone sees after registering. It is
 * deliberately a short read rather than a spotlight tour that drags the
 * reader through four pages: someone who has just signed up wants to know
 * what this shop can do for them, not to be steered around a UI they have
 * not decided to use yet.
 *
 * "Seen it" lives on the account (User.clientTourSeenAt), not in this
 * browser, so registering on a phone and signing in on a laptop does not
 * replay it. Skipping counts as seen — a reader who closes a guide has told
 * you something, and asking again next visit ignores it.
 *
 * Customer module only: nothing loads this but the customer dashboard, and
 * the endpoint behind it refuses anyone who is not a customer.
 */
import { api } from '/js/api.js';
import { icon } from '/js/icons.js';
import { initModal } from '/js/modal.js';

/**
 * Every step describes something the reader can actually do, in the words
 * the page itself uses ("Cash on Pickup", "Colour Studio"), so the guide and
 * the screen agree once they get there.
 */
const STEPS = [
  {
    icon: 'store',
    title: 'Welcome to Flavor & Color',
    body: `Order paint for pickup at the store, or have a shade mixed by hand
           to match anything you bring us. Here is how the whole thing works —
           it takes about a minute to read.`,
  },
  {
    icon: 'shopping-cart',
    title: 'Find your paint',
    body: `<strong>Browse Products</strong> lists what's on our shelves right
           now, with each paint's real color, finish and can size. Add what
           you need to your cart — prices and stock come straight from the
           store, so what you see is what you pay.`,
    link: { href: '/client/products', label: 'Browse Products' },
  },
  {
    icon: 'droplets',
    title: "Need a color we don't stock?",
    body: `In <strong>Color Studio</strong>, pick a shade on the wheel or pull
           one straight out of a photo. We show you the closest paints already
           on our shelves — and if none of them is right, request a custom mix
           and one of our mixers matches it by hand.`,
    link: { href: '/client/colors', label: 'Open Color Studio' },
  },
  {
    icon: 'credit-card',
    title: 'Checking out',
    body: `Choose how you'd like to pay. <strong>GCash</strong> — transfer the
           amount and upload your receipt on the next screen; we prepare the
           order once the cashier has checked it. <strong>Cash on
           Pickup</strong> — we start preparing right away and you pay at the
           counter.`,
  },
  {
    icon: 'package',
    title: 'Follow it to the counter',
    body: `<strong>My Orders</strong> shows every order and exactly where it
           is: waiting on payment, being prepared, or ready for pickup. Your
           invoice sits there too, and we email you when something changes.`,
    link: { href: '/client/orders', label: 'My Orders' },
  },
];

const SESSION_KEY = 'fc.clientTourDismissed';

let controller = null; // built once per page load, reused by the replay button
let seenPromise = null; // memoized: closing twice must not post twice

async function postSeen() {
  // Held for this tab as well, so a failed request cannot reopen the tour
  // on the next navigation within the same visit.
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Private browsing with storage denied: the request below still stands.
  }

  try {
    await api('/api/auth/client-tour/complete', { method: 'POST' });
  } catch {
    // Nothing to say to the reader — they came here to look at paint. If it
    // failed, the worst case is being offered the guide once more.
  }
}

/**
 * Records the tour as seen, at most once per page load. Returns a promise so
 * a caller that is about to navigate can let the request land first — a
 * closing modal followed by location.assign() would otherwise cancel it.
 */
function markSeen() {
  if (!seenPromise) seenPromise = postSeen();
  return seenPromise;
}

function stepMarkup(step, index) {
  const link = step.link
    ? `<a class="btn btn-outline btn-sm tour-step-link" href="${step.link.href}">
         ${step.link.label} ${icon('chevron-right', 14)}
       </a>`
    : '';

  return `
    <section class="tour-step" data-tour-step="${index}" hidden>
      <span class="tour-step-icon">${icon(step.icon, 24)}</span>
      <h3 class="tour-step-title">${step.title}</h3>
      <p class="tour-step-body">${step.body}</p>
      ${link}
    </section>
  `;
}

function build() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'client-tour';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="modal tour-modal" role="dialog" aria-modal="true" aria-labelledby="client-tour-title">
      <header class="modal-header">
        <h2 class="modal-title" id="client-tour-title">Getting started</h2>
        <button type="button" class="modal-close" data-modal-close aria-label="Close">×</button>
      </header>

      <div class="modal-body tour-body">
        ${STEPS.map(stepMarkup).join('')}
      </div>

      <footer class="modal-footer tour-footer">
        <ol class="tour-dots" aria-label="Progress">
          ${STEPS.map(
            (step, i) =>
              `<li><button type="button" class="tour-dot" data-tour-go="${i}"
                   aria-label="Step ${i + 1}: ${step.title}"></button></li>`
          ).join('')}
        </ol>
        <div class="tour-actions">
          <button type="button" class="btn btn-outline btn-sm" data-modal-close data-tour-skip>Skip</button>
          <button type="button" class="btn btn-outline btn-sm" data-tour-prev>Back</button>
          <button type="button" class="btn btn-primary btn-sm" data-tour-next>Next</button>
        </div>
      </footer>
    </div>
  `;
  document.body.appendChild(backdrop);
  return backdrop;
}

function create() {
  const backdrop = build();
  // Closing by any route — Escape, the backdrop, the × — counts as seen.
  const modal = initModal(backdrop, { onClose: markSeen });

  const steps = [...backdrop.querySelectorAll('[data-tour-step]')];
  const dots = [...backdrop.querySelectorAll('[data-tour-go]')];
  const prevBtn = backdrop.querySelector('[data-tour-prev]');
  const nextBtn = backdrop.querySelector('[data-tour-next]');
  const skipBtn = backdrop.querySelector('[data-tour-skip]');

  let current = 0;

  function show(index) {
    current = Math.min(Math.max(index, 0), steps.length - 1);

    steps.forEach((section, i) => {
      section.hidden = i !== current;
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-current', i === current);
      dot.classList.toggle('is-seen', i < current);
      // The dot for the step you are on is not a place you can navigate to.
      dot.setAttribute('aria-current', i === current ? 'step' : 'false');
    });

    prevBtn.disabled = current === 0;
    const last = current === steps.length - 1;
    nextBtn.textContent = last ? 'Start browsing' : 'Next';
    // Once they have read it through, "Skip" is the wrong word for the exit.
    skipBtn.textContent = last ? 'Close' : 'Skip';
  }

  nextBtn.addEventListener('click', async () => {
    if (current < steps.length - 1) return show(current + 1);
    modal.close(); // marks seen via onClose
    await markSeen(); // same memoized request — land it before navigating
    window.location.assign('/client/products');
  });

  prevBtn.addEventListener('click', () => show(current - 1));
  dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));

  // A guide you page through should answer the arrow keys.
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') show(current + 1);
    else if (event.key === 'ArrowLeft') show(current - 1);
  });

  return {
    open(startAt = 0) {
      show(startAt);
      modal.open();
    },
  };
}

/** Opens the walkthrough, building it on first use. */
export function openClientTour() {
  if (!controller) controller = create();
  controller.open();
}

/**
 * Shows the walkthrough if this customer has never been through it.
 * Takes the user already fetched by the page rather than asking again.
 */
export function maybeStartClientTour(user) {
  if (user.clientTourSeenAt) return false;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
  } catch {
    // Storage denied: fall through and show it.
  }
  openClientTour();
  return true;
}
