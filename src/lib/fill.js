"use strict";

const { parseColor, clamp } = require("./colors");
const { resolveAsset, rasterize } = require("./assets");

function compiledStops(stops) {
  return stops
    .map((s) => ({ offset: clamp(s.offset, 0, 1), rgba: parseColor(s.color) }))
    .sort((a, b) => a.offset - b.offset);
}

function sampleStops(stops, t) {
  const tt = clamp(t, 0, 1);
  if (tt <= stops[0].offset) return stops[0].rgba;
  const last = stops[stops.length - 1];
  if (tt >= last.offset) return last.rgba;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (tt <= b.offset) {
      const span = b.offset - a.offset;
      const f = span <= 1e-6 ? 0 : (tt - a.offset) / span;
      return [
        a.rgba[0] + (b.rgba[0] - a.rgba[0]) * f,
        a.rgba[1] + (b.rgba[1] - a.rgba[1]) * f,
        a.rgba[2] + (b.rgba[2] - a.rgba[2]) * f,
        a.rgba[3] + (b.rgba[3] - a.rgba[3]) * f,
      ];
    }
  }
  return last.rgba;
}

function linearT(x, y, size, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const min = Math.min(0, dx) + Math.min(0, dy);
  const max = Math.max(0, dx) + Math.max(0, dy);
  const denom = max - min;
  if (denom < 1e-6) return 0;
  return (u * dx + v * dy - min) / denom;
}

function radialT(x, y, size, cx, cy, radius) {
  const u = (x + 0.5) / size - cx;
  const v = (y + 0.5) / size - cy;
  return Math.hypot(u, v) / Math.max(radius, 1e-6);
}

function conicT(x, y, size, cx, cy, angleDeg) {
  const u = (x + 0.5) / size - cx;
  const v = (y + 0.5) / size - cy;
  const a = Math.atan2(u, -v);
  const start = (angleDeg * Math.PI) / 180;
  const t = (a - start) / (Math.PI * 2);
  return ((t % 1) + 1) % 1;
}

function writeSolid(size, color, opacity) {
  const out = Buffer.alloc(size * size * 4);
  const [r, g, b, a] = color;
  const alpha = Math.round(clamp(a * opacity, 0, 1) * 255);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = alpha;
  }
  return out;
}

function writeGradient(size, fill, opacity) {
  const out = Buffer.alloc(size * size * 4);
  const stops = compiledStops(fill.stops);
  const type = fill.type;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let t = 0;
      if (type === "linear") {
        t = linearT(x, y, size, fill.angle);
      } else if (type === "radial") {
        t = radialT(x, y, size, fill.cx, fill.cy, fill.radius);
      } else {
        t = conicT(x, y, size, fill.cx, fill.cy, fill.angle);
      }
      const [r, g, b, a] = sampleStops(stops, t);
      const i = (y * size + x) * 4;
      out[i] = Math.round(r);
      out[i + 1] = Math.round(g);
      out[i + 2] = Math.round(b);
      out[i + 3] = Math.round(clamp(a * opacity, 0, 1) * 255);
    }
  }
  return out;
}

async function writePattern(size, fill, configDir, opacity) {
  if (!fill.source) {
    return Buffer.alloc(size * size * 4);
  }
  const file = await resolveAsset(configDir, fill.source);
  const tileSize = Math.max(
    4,
    Math.min(Math.round(size * 4), Math.round(fill.scale * size)),
  );
  const tile = await rasterize(file, tileSize, tileSize, { fit: "contain" });
  const tw = tile.width;
  const th = tile.height;
  const ox = Math.round(fill.offset_x * size);
  const oy = Math.round(fill.offset_y * size);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    let sy = (((y - oy) % th) + th) % th;
    for (let x = 0; x < size; x++) {
      let sx = (((x - ox) % tw) + tw) % tw;
      const si = (sy * tw + sx) * 4;
      const di = (y * size + x) * 4;
      out[di] = tile.data[si];
      out[di + 1] = tile.data[si + 1];
      out[di + 2] = tile.data[si + 2];
      out[di + 3] = Math.round(tile.data[si + 3] * opacity);
    }
  }
  return out;
}

/**
 * Build an RGBA fill layer at `size` x `size`.
 * ctx: { configDir }
 */
async function buildFill(fill, size, ctx) {
  const opacity = fill && fill.opacity !== undefined ? fill.opacity : 1;
  if (!fill) return Buffer.alloc(size * size * 4);
  if (fill.type === "solid") {
    return writeSolid(size, parseColor(fill.color), opacity);
  }
  if (fill.type === "pattern") {
    return writePattern(size, fill, ctx.configDir, opacity);
  }
  return writeGradient(size, fill, opacity);
}

module.exports = { buildFill, sampleStops, compiledStops };
