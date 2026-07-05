/**
 * Color Studio: interactive HSL color wheel, photo palette extraction
 * (fully client-side), closest-paint matching, and custom mix requests.
 */
import { api } from '/js/api.js';
import { showToast } from '/js/toast.js';
import { escapeHtml, formatPrice, formatDate, debounce } from '/js/format.js';
import { renderPagination } from '/js/pagination.js';
import { initModal } from '/js/modal.js';
import { showFieldErrors, clearFieldErrors, setBusy } from '/js/form-utils.js';
import { getCurrentUser } from '/js/session.js';
import { addItem } from '/js/cart.js';
import { icon } from '/js/icons.js';
import { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, extractPalette } from '/js/color-utils.js';

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

const AVAILABILITY_BADGES = {
  in_stock: '<span class="badge badge-success">In stock</span>',
  low_stock: '<span class="badge badge-warning">Low stock</span>',
  out_of_stock: '<span class="badge badge-danger">Out of stock</span>',
};

const MIX_STATUS_BADGES = {
  queued: '<span class="badge badge-warning">Queued</span>',
  mixing: '<span class="badge badge-info">Mixing</span>',
  completed: '<span class="badge badge-success">Completed</span>',
  cancelled: '<span class="badge badge-danger">Cancelled</span>',
};

// Current color as HSL — the single source of truth for the page.
const color = { h: 245, s: 60, l: 55 };
let userId = null;

/* ---------- Color wheel ---------- */

const wheelCanvas = document.querySelector('#color-wheel');
const marker = document.querySelector('#wheel-marker');
const WHEEL_CSS_SIZE = 260;

function drawWheel() {
  const dpr = window.devicePixelRatio || 1;
  const size = WHEEL_CSS_SIZE * dpr;
  wheelCanvas.width = size;
  wheelCanvas.height = size;

  const ctx = wheelCanvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const radius = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - radius;
      const dy = y - radius;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;

      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const sat = Math.min(dist / radius, 1) * 100;
      const { r, g, b } = hslToRgb(hue, sat, 50);

      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      // Soften the outer edge instead of a hard pixel cut.
      image.data[i + 3] = Math.max(0, Math.min(255, (radius - dist + 1) * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
}

function pickFromWheel(event) {
  const rect = wheelCanvas.getBoundingClientRect();
  const radius = rect.width / 2;
  const dx = event.clientX - rect.left - radius;
  const dy = event.clientY - rect.top - radius;
  const dist = Math.min(Math.sqrt(dx * dx + dy * dy), radius);

  color.h = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
  color.s = Math.round((dist / radius) * 100);
  render();
}

let dragging = false;
wheelCanvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  wheelCanvas.setPointerCapture(event.pointerId);
  pickFromWheel(event);
});
wheelCanvas.addEventListener('pointermove', (event) => {
  if (dragging) pickFromWheel(event);
});
wheelCanvas.addEventListener('pointerup', () => {
  dragging = false;
});

/* ---------- Readouts & state rendering ---------- */

const lightnessSlider = document.querySelector('#lightness-slider');
const hexInput = document.querySelector('#hex-input');

lightnessSlider.addEventListener('input', () => {
  color.l = Number(lightnessSlider.value);
  render();
});

hexInput.addEventListener('change', () => {
  const value = hexInput.value.trim();
  if (!HEX_RE.test(value)) {
    showToast('Enter a hex color like #4F46E5.', 'warning');
    render(); // restore the current value
    return;
  }
  const { r, g, b } = hexToRgb(value.startsWith('#') ? value : `#${value}`);
  Object.assign(color, rgbToHsl(r, g, b));
  render();
});

const currentHex = () => {
  const { r, g, b } = hslToRgb(color.h, color.s, color.l);
  return rgbToHex(r, g, b);
};

function render() {
  const hex = currentHex();
  const { r, g, b } = hexToRgb(hex);

  document.querySelector('#color-swatch').style.backgroundColor = hex;
  hexInput.value = hex;
  document.querySelector('#rgb-value').textContent = `rgb(${r}, ${g}, ${b})`;
  document.querySelector('#hsl-value').textContent = `hsl(${color.h}, ${color.s}%, ${color.l}%)`;

  // Marker position mirrors the hue/saturation math used when picking.
  const radius = WHEEL_CSS_SIZE / 2;
  const angle = (color.h * Math.PI) / 180;
  const dist = (color.s / 100) * radius;
  marker.style.left = `${radius + Math.cos(angle) * dist}px`;
  marker.style.top = `${radius + Math.sin(angle) * dist}px`;
  marker.style.backgroundColor = hex;

  lightnessSlider.value = color.l;
  lightnessSlider.style.background =
    `linear-gradient(to right, #000, hsl(${color.h}, ${color.s}%, 50%), #fff)`;

  loadMatchesDebounced();
}

/* ---------- Photo palette ---------- */

const uploadZone = document.querySelector('#upload-zone');
const photoInput = document.querySelector('#photo-input');
const photoImg = document.querySelector('#photo-img');
const paletteRow = document.querySelector('#palette-row');

uploadZone.addEventListener('click', () => photoInput.click());
uploadZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    photoInput.click();
  }
});

uploadZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  uploadZone.classList.add('is-dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragover'));
uploadZone.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadZone.classList.remove('is-dragover');
  const file = event.dataTransfer.files?.[0];
  if (file) loadPhoto(file);
});

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (file) loadPhoto(file);
});

function loadPhoto(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file.', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    photoImg.onload = () => {
      const palette = extractPalette(photoImg, 6);
      renderPalette(palette);
      document.querySelector('#photo-preview').classList.add('is-visible');
      if (palette.length > 0) selectPaletteColor(palette[0]);
    };
    photoImg.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderPalette(palette) {
  paletteRow.innerHTML = palette
    .map(
      (hex) => `<button type="button" class="palette-chip" data-hex="${hex}"
        style="background-color: ${hex}" aria-label="Select ${hex}"></button>`
    )
    .join('');
}

function selectPaletteColor(hex) {
  paletteRow.querySelectorAll('.palette-chip').forEach((chip) => {
    chip.classList.toggle('is-selected', chip.dataset.hex === hex);
  });
  const { r, g, b } = hexToRgb(hex);
  Object.assign(color, rgbToHsl(r, g, b));
  render();
}

paletteRow.addEventListener('click', (event) => {
  const chip = event.target.closest('.palette-chip');
  if (chip) selectPaletteColor(chip.dataset.hex);
});

/* ---------- Matching paints ---------- */

const matchList = document.querySelector('#match-list');

async function loadMatches() {
  const hex = currentHex().replace('#', '');
  try {
    const { data } = await api(`/api/products/match?hex=${hex}&limit=4`);
    renderMatches(data.matches);
  } catch (error) {
    showToast(error.message, 'error');
  }
}
const loadMatchesDebounced = debounce(loadMatches, 350);

function renderMatches(matches) {
  if (matches.length === 0) {
    matchList.innerHTML = '<p class="text-muted">No colored paints in the catalog yet.</p>';
    return;
  }

  matchList.innerHTML = matches
    .map(({ product, matchPercent }) => {
      const meta = [product.color?.name, product.finish, product.size]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');
      const out = product.availability === 'out_of_stock';
      return `
        <div class="match-row">
          <span class="swatch" style="background-color: ${escapeHtml(product.color.hex)}"></span>
          <div class="match-info">
            <div class="match-name">${escapeHtml(product.name)}</div>
            <div class="match-meta">${meta} · ${formatPrice(product.price)}</div>
          </div>
          <span class="match-percent ${matchPercent < 70 ? 'is-far' : ''}">${matchPercent}% match</span>
          ${AVAILABILITY_BADGES[product.availability] || ''}
          <button class="btn btn-outline btn-sm" data-add-to-cart="${product.id}"
                  data-name="${escapeHtml(product.name)}" ${out ? 'disabled' : ''}>
            ${icon('shopping-cart', 14)} Add
          </button>
        </div>`;
    })
    .join('');
}

const matchesCache = new Map();
matchList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-add-to-cart]');
  if (!button || !userId) return;
  // Fetch the product fresh so the cart gets accurate price/color data.
  try {
    const { data } = await api(`/api/products/${button.dataset.addToCart}`);
    addItem(userId, data.product);
    showToast(`${data.product.name} added to cart.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

/* ---------- Custom mix request ---------- */

const mixModal = initModal(document.querySelector('#mix-modal'));
const mixForm = document.querySelector('#mix-form');
let basePaintsLoaded = false;

document.querySelector('#request-mix-btn').addEventListener('click', async () => {
  clearFieldErrors(mixForm);
  mixForm.reset();

  const hex = currentHex();
  document.querySelector('#mix-color-swatch').style.backgroundColor = hex;
  document.querySelector('#mix-color-hex').textContent = hex;

  if (!basePaintsLoaded) await loadBasePaints();
  mixModal.open();
});

async function loadBasePaints() {
  try {
    const { data } = await api('/api/products?limit=50&sort=name');
    const select = document.querySelector('#mix-base');
    data.products
      .filter((p) => p.category !== 'supplies')
      .forEach((p) => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.name}${p.size ? ` (${p.size})` : ''}`;
        select.appendChild(option);
      });
    basePaintsLoaded = true;
  } catch {
    // The select still works with just the default option.
  }
}

mixForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(mixForm);
  const submitButton = document.querySelector('#mix-submit-btn');
  setBusy(submitButton, true, 'Submitting…');

  try {
    const { message } = await api('/api/mixing/requests', {
      method: 'POST',
      body: {
        targetColor: {
          hex: document.querySelector('#mix-color-hex').textContent,
          name: mixForm.elements['targetColor.name'].value,
        },
        productId: mixForm.elements.productId.value || undefined,
        quantity: parseInt(mixForm.elements.quantity.value, 10) || 1,
        notes: mixForm.elements.notes.value,
      },
    });
    showToast(message, 'success');
    mixModal.close();
    loadMixes();
  } catch (error) {
    if (error.errors) showFieldErrors(mixForm, error.errors);
    showToast(error.message, 'error');
  } finally {
    setBusy(submitButton, false);
  }
});

/* ---------- My mix requests ---------- */

const mixesTbody = document.querySelector('#mixes-tbody');
const confirmModal = initModal(document.querySelector('#confirm-modal'));
let mixesPage = 1;
let cancelRequestId = null;

async function loadMixes() {
  try {
    const { data } = await api(`/api/mixing/requests?page=${mixesPage}&limit=5`);
    renderMixes(data.requests);
    renderPagination(document.querySelector('#mixes-pagination'), data.pagination, (page) => {
      mixesPage = page;
      loadMixes();
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderMixes(requests) {
  document.querySelector('#mixes-empty').hidden = requests.length > 0;

  mixesTbody.innerHTML = requests
    .map((r) => {
      const base = r.product
        ? `${escapeHtml(r.product.name)}${r.product.size ? ` (${escapeHtml(r.product.size)})` : ''}`
        : 'Mixer’s choice';
      const cancelButton =
        r.status === 'queued'
          ? `<button class="btn btn-outline btn-sm" data-cancel="${r.id}" data-number="${escapeHtml(r.requestNumber)}">Cancel</button>`
          : '';
      return `
        <tr>
          <td><strong>${escapeHtml(r.requestNumber)}</strong></td>
          <td>
            <div class="product-cell" style="min-width: 130px;">
              <span class="swatch" style="background-color: ${escapeHtml(r.targetColor.hex)}"></span>
              <div>
                <div class="name">${escapeHtml(r.targetColor.name || r.targetColor.hex)}</div>
                ${r.targetColor.name ? `<div class="meta">${escapeHtml(r.targetColor.hex)}</div>` : ''}
              </div>
            </div>
          </td>
          <td>${base} × ${r.quantity}</td>
          <td>${formatDate(r.createdAt)}</td>
          <td>${MIX_STATUS_BADGES[r.status] || escapeHtml(r.status)}</td>
          <td><div class="cell-actions">${cancelButton}</div></td>
        </tr>`;
    })
    .join('');
}

mixesTbody.addEventListener('click', (event) => {
  const button = event.target.closest('[data-cancel]');
  if (!button) return;
  cancelRequestId = button.dataset.cancel;
  document.querySelector('#confirm-message').textContent =
    `Cancel mix request ${button.dataset.number}?`;
  confirmModal.open();
});

document.querySelector('#confirm-btn').addEventListener('click', async () => {
  if (!cancelRequestId) return;
  try {
    const { message } = await api(`/api/mixing/requests/${cancelRequestId}/cancel`, {
      method: 'POST',
    });
    showToast(message, 'success');
    loadMixes();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    cancelRequestId = null;
    confirmModal.close();
  }
});

/* ---------- Init ---------- */

async function init() {
  drawWheel();
  render();
  loadMixes();
  const user = await getCurrentUser();
  userId = user.id;
}

init();
