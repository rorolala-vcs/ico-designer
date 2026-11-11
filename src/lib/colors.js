'use strict';

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function clamp01(n) {
  return clamp(n, 0, 1);
}

function num(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHex(value, fallback = '#000000') {
  if (typeof value !== 'string') return fallback;
  let s = value.trim().toLowerCase();
  if (s === 'transparent') return '#00000000';
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  if (/^[0-9a-f]{4}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `#${s}`;
  return fallback;
}

function parseColor(value, fallback = [0, 0, 0, 1]) {
  if (Array.isArray(value)) {
    return [
      clamp(Math.round(num(value[0], 0)), 0, 255),
      clamp(Math.round(num(value[1], 0)), 0, 255),
      clamp(Math.round(num(value[2], 0)), 0, 255),
      clamp(num(value[3], 1), 0, 1),
    ];
  }
  const hex = normalizeHex(value, null);
  if (!hex) return fallback;
  const s = hex.slice(1);
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
    s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1,
  ];
}

function rgbaToHex([r, g, b, a], withAlpha = false) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${withAlpha ? h(a * 255) : ''}`;
}

function mixColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/** Darken (amount < 0) or lighten (amount > 0) a hex color. */
function shade(hex, amount) {
  const c = parseColor(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return rgbaToHex(mixColor(c, [target, target, target, c[3]], clamp01(t)), c[3] < 1);
}

function cssColor(hex, alpha) {
  const [r, g, b, a] = parseColor(hex);
  const finalAlpha = alpha === undefined ? a : clamp01(alpha);
  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
}

module.exports = {
  clamp,
  clamp01,
  num,
  isPlainObject,
  normalizeHex,
  parseColor,
  rgbaToHex,
  mixColor,
  shade,
  cssColor,
};
