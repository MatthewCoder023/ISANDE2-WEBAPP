/**
 * Client-side color science: hex/RGB/HSL conversions and dominant-color
 * extraction via median-cut quantization (the same algorithm libraries
 * like ColorThief use, implemented here to keep the app dependency-free).
 *
 * Images are processed entirely in the browser — pixels never leave
 * the user's machine.
 */

/* ---------- Conversions ---------- */

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function rgbToHex(r, g, b) {
  const to2 = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

/** r,g,b 0-255 -> { h: 0-360, s: 0-100, l: 0-100 } */
export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** h 0-360, s 0-100, l 0-100 -> { r, g, b } 0-255 */
export function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const m = ln - c / 2;
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/* ---------- Dominant-color extraction (median cut) ---------- */

const SAMPLE_SIZE = 96; // longest edge after downscale; keeps this instant

function channelRanges(pixels) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const p of pixels) {
    for (let c = 0; c < 3; c += 1) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

function widestBox(boxes) {
  let bestIndex = 0;
  let bestRange = -1;
  boxes.forEach((box, i) => {
    const range = Math.max(...channelRanges(box));
    if (range > bestRange && box.length > 1) {
      bestRange = range;
      bestIndex = i;
    }
  });
  return bestIndex;
}

function averageColor(pixels) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = pixels.length;
  return rgbToHex(r / n, g / n, b / n);
}

/**
 * Extracts the dominant colors of an <img> element.
 * @returns string[] hex colors, largest population first
 */
export function extractPalette(img, colorCount = 6) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(SAMPLE_SIZE / img.naturalWidth, SAMPLE_SIZE / img.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) return [];

  // Median cut: repeatedly split the box with the widest channel range
  // at its median until we have colorCount boxes.
  let boxes = [pixels];
  while (boxes.length < colorCount) {
    const index = widestBox(boxes);
    const box = boxes[index];
    if (box.length < 2) break;

    const ranges = channelRanges(box);
    const channel = ranges.indexOf(Math.max(...ranges));
    box.sort((a, b) => a[channel] - b[channel]);

    const mid = Math.floor(box.length / 2);
    boxes.splice(index, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.sort((a, b) => b.length - a.length).map(averageColor);
}
