/**
 * Server-side color math for paint matching.
 *
 * Distances are computed in CIELAB space (ΔE*76) because Euclidean
 * distance in RGB does not reflect how different two colors *look*.
 * ΔE ≈ 2 is barely noticeable; ΔE > 50 is a clearly different color.
 */
const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** sRGB (0-255) -> CIELAB via linear RGB and XYZ (D65 white point). */
function rgbToLab([r, g, b]) {
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];

  // Linear RGB -> XYZ, scaled against D65 reference white.
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE*76 — Euclidean distance in Lab space. */
function deltaE(lab1, lab2) {
  return Math.sqrt(
    (lab1[0] - lab2[0]) ** 2 + (lab1[1] - lab2[1]) ** 2 + (lab1[2] - lab2[2]) ** 2
  );
}

const hexToLab = (hex) => rgbToLab(hexToRgb(hex));

module.exports = { HEX_COLOR_REGEX, hexToRgb, rgbToLab, deltaE, hexToLab };
