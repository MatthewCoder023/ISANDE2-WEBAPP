/**
 * Document verification. Reachable by scanning the QR on an invoice (which
 * fills both fields from the URL and checks immediately) or by typing the
 * code by hand from the printed page.
 */
import { escapeHtml, formatPrice, formatDateTime } from '/js/format.js';
import { setBusy } from '/js/form-utils.js';

const form = document.querySelector('#verify-form');
const resultEl = document.querySelector('#result');
const boxEl = document.querySelector('#result-box');
const factsEl = document.querySelector('#result-facts');

function show({ ok, title, message, facts }) {
  resultEl.hidden = false;
  boxEl.style.backgroundColor = ok ? 'var(--success-50)' : 'var(--danger-50)';
  boxEl.style.border = `1px solid ${ok ? 'var(--success-500)' : 'var(--danger-500)'}`;
  boxEl.style.color = ok ? 'var(--success-500)' : 'var(--danger-500)';

  document.querySelector('#result-title').textContent = title;
  document.querySelector('#result-message').textContent = message;

  factsEl.hidden = !facts;
  factsEl.innerHTML = facts
    ? Object.entries(facts)
        .map(
          ([label, value]) =>
            `<dt class="text-muted">${escapeHtml(label)}</dt><dd style="color: var(--text);">${escapeHtml(value)}</dd>`
        )
        .join('')
    : '';
}

async function check(orderNumber, code) {
  const params = new URLSearchParams({ order: orderNumber, code });
  const response = await fetch(`/api/orders/verify?${params}`);
  const body = await response.json();

  if (!response.ok || !body.data?.valid) {
    show({
      ok: false,
      title: 'Not verified',
      message: body.message || 'This document could not be verified.',
    });
    return;
  }

  const { orderNumber: number, total, issuedAt, itemCount } = body.data;
  show({
    ok: true,
    title: 'Verified — this document matches our records',
    message: 'The figures below are what our system holds for this order.',
    facts: {
      Order: number,
      Issued: formatDateTime(issuedAt),
      Items: `${itemCount} line${itemCount === 1 ? '' : 's'}`,
      Total: formatPrice(total),
    },
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, 'Checking…');
  try {
    await check(form.order.value.trim(), form.code.value.trim().toUpperCase());
  } catch {
    show({
      ok: false,
      title: 'Could not check right now',
      message: 'We could not reach the server. Please try again in a moment.',
    });
  } finally {
    setBusy(button, false);
  }
});

// Arriving from the QR code: prefill and check without making them press.
const params = new URLSearchParams(window.location.search);
const presetOrder = params.get('order');
const presetCode = params.get('code');
if (presetOrder && presetCode) {
  form.order.value = presetOrder;
  form.code.value = presetCode.toUpperCase();
  check(presetOrder, presetCode.toUpperCase());
}
