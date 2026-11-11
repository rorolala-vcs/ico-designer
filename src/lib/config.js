"use strict";

const {
  clamp,
  clamp01,
  num,
  isPlainObject,
  normalizeHex,
  shade,
} = require("./colors");

const SCHEMA = 1;
const ID_KEYS = ["RedId", "BlueId", "GreenId"];
const FILL_TYPES = ["solid", "linear", "radial", "conic", "pattern"];
const DEFAULT_ID_COLORS = {
  RedId: "#d92b2b",
  BlueId: "#1926d2",
  GreenId: "#1976d2",
};
const GREEN_DARK = "#0a3d91";
const DEFAULT_FONT = "sans-serif";

function defaultStops(id) {
  if (id === "GreenId") {
    return [
      { offset: 0, color: "#1976d2" },
      { offset: 1, color: GREEN_DARK },
    ];
  }
  const base = DEFAULT_ID_COLORS[id] || "#808080";
  return [
    { offset: 0, color: shade(base, 0.18) },
    { offset: 1, color: shade(base, -0.4) },
  ];
}

function normalizeStops(raw, fallbackColor, id) {
  let stops = [];
  if (Array.isArray(raw)) {
    stops = raw
      .filter((s) => isPlainObject(s))
      .map((s) => ({
        offset: clamp01(num(s.offset, 0)),
        color: normalizeHex(s.color, fallbackColor || "#808080"),
      }));
  }
  if (stops.length === 0) return defaultStops(id);
  stops.sort((a, b) => a.offset - b.offset);
  if (stops.length === 1) {
    return [
      { offset: 0, color: stops[0].color },
      { offset: 1, color: shade(stops[0].color, -0.35) },
    ];
  }
  if (stops[0].offset > 0) stops.unshift({ offset: 0, color: stops[0].color });
  const last = stops[stops.length - 1];
  if (last.offset < 1) stops.push({ offset: 1, color: last.color });
  return stops;
}

function normalizeFill(raw, id) {
  const src = isPlainObject(raw) ? raw : {};
  let type = FILL_TYPES.includes(src.type) ? src.type : "solid";
  const fallbackColor = normalizeHex(
    src.color,
    DEFAULT_ID_COLORS[id] || "#808080",
  );
  const out = { type };

  if (type === "solid") {
    out.color = fallbackColor;
    return out;
  }

  if (type === "pattern") {
    out.source = typeof src.source === "string" ? src.source.trim() : "";
    out.scale = clamp(num(src.scale, 0.25), 0.01, 4);
    out.offset_x = clamp(num(src.offset_x, 0), -4, 4);
    out.offset_y = clamp(num(src.offset_y, 0), -4, 4);
  } else {
    out.angle =
      ((num(src.angle, type === "linear" ? 90 : 0) % 360) + 360) % 360;
    if (type !== "linear") {
      out.cx = clamp(num(src.cx, 0.5), -1, 2);
      out.cy = clamp(num(src.cy, 0.5), -1, 2);
    }
    if (type === "radial") {
      out.radius = clamp(num(src.radius, 0.72), 0.01, 4);
    }
    out.stops = normalizeStops(src.stops, fallbackColor, id);
  }

  const opacity = num(src.opacity, 1);
  if (opacity < 1) out.opacity = clamp01(opacity);
  return out;
}

function defaultStroke() {
  return { enabled: false, color: "#ffffff", width: 0.012, opacity: 1 };
}

function defaultShadow(enabled) {
  return {
    enabled: Boolean(enabled),
    color: "#000000",
    opacity: 0.35,
    blur: 0.03,
    dx: 0,
    dy: 0.012,
  };
}

function normalizeStroke(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    color: normalizeHex(src.color, "#ffffff"),
    width: clamp(num(src.width, 0.012), 0, 0.5),
    opacity: clamp01(num(src.opacity, 1)),
  };
}

function normalizeShadow(raw) {
  const src = isPlainObject(raw) ? raw : {};
  return {
    enabled: Boolean(src.enabled),
    color: normalizeHex(src.color, "#000000"),
    opacity: clamp01(num(src.opacity, 0.35)),
    blur: clamp(num(src.blur, 0.03), 0, 0.5),
    dx: clamp(num(src.dx, 0), -0.5, 0.5),
    dy: clamp(num(src.dy, 0.012), -0.5, 0.5),
  };
}

function asciiOnly(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 200);
}

function normalizeSticker(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const kind = src.kind === "text" ? "text" : "icon";
  const out = {
    kind,
    x: clamp(num(src.x, 0.5), -2, 3),
    y: clamp(num(src.y, 0.5), -2, 3),
    offset_x: clamp(num(src.offset_x, 0), -2, 2),
    offset_y: clamp(num(src.offset_y, 0), -2, 2),
    scale: clamp(num(src.scale, kind === "icon" ? 0.6 : 0.18), 0.005, 8),
    rotation: num(src.rotation, 0) % 360,
    opacity: clamp01(num(src.opacity, 1)),
    color: normalizeHex(src.color, "#ffffff"),
    stroke: normalizeStroke(src.stroke),
    shadow: normalizeShadow(src.shadow),
  };

  if (kind === "icon") {
    out.source = typeof src.source === "string" ? src.source.trim() : "";
    out.recolor = Boolean(
      src.recolor === undefined ? src.color != null : src.recolor,
    );
    if (out.recolor === false) out.color = null;
  } else {
    out.text = asciiOnly(src.text);
    const font = typeof src.font === "string" ? src.font.trim() : "";
    out.font = font || DEFAULT_FONT;
    out.weight = clamp(Math.round(num(src.weight, 700) / 100) * 100, 100, 900);
    out.recolor = false;
  }
  return out;
}

function defaultConfig() {
  return normalizeConfig({
    schema: SCHEMA,
    category: "doc-base",
    size: 512,
    ids: {
      RedId: { type: "solid", color: DEFAULT_ID_COLORS.RedId },
      BlueId: { type: "solid", color: DEFAULT_ID_COLORS.BlueId },
      GreenId: {
        type: "linear",
        angle: 90,
        stops: defaultStops("GreenId"),
      },
    },
    stickers: [
      {
        kind: "icon",
        source: "Park",
        x: 0.5,
        y: 0.53,
        scale: 0.62,
        color: "#ffffff",
        recolor: true,
        shadow: { enabled: true },
      },
    ],
  });
}

function normalizeConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};
  const idsSrc = isPlainObject(src.ids) ? src.ids : {};
  const ids = {};
  for (const key of ID_KEYS) {
    ids[key] = normalizeFill(idsSrc[key], key);
  }

  const stickers = Array.isArray(src.stickers)
    ? src.stickers.map(normalizeSticker)
    : [];

  const category =
    typeof src.category === "string" && /^[A-Za-z0-9_-]+$/.test(src.category)
      ? src.category
      : "doc-base";

  return {
    schema: SCHEMA,
    category,
    size: clamp(Math.round(num(src.size, 512)), 16, 4096),
    ids,
    stickers,
  };
}

function fmt(n) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10000) / 10000;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function q(value) {
  const s = String(value === undefined || value === null ? "" : value);
  return JSON.stringify(s)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serializeFill(lines, key, fill) {
  lines.push(`[ids.${key}]`);
  lines.push(`type = ${q(fill.type)}`);
  if (fill.type === "solid") {
    lines.push(`color = ${q(fill.color)}`);
  } else if (fill.type === "pattern") {
    lines.push(`source = ${q(fill.source)}`);
    lines.push(`scale = ${fmt(fill.scale)}`);
    lines.push(`offset_x = ${fmt(fill.offset_x)}`);
    lines.push(`offset_y = ${fmt(fill.offset_y)}`);
  } else {
    lines.push(`angle = ${fmt(fill.angle)}`);
    if (fill.type === "radial") {
      lines.push(`cx = ${fmt(fill.cx)}`);
      lines.push(`cy = ${fmt(fill.cy)}`);
      lines.push(`radius = ${fmt(fill.radius)}`);
    } else if (fill.type === "conic") {
      lines.push(`cx = ${fmt(fill.cx)}`);
      lines.push(`cy = ${fmt(fill.cy)}`);
    }
    lines.push("stops = [");
    for (const stop of fill.stops) {
      lines.push(
        `  { offset = ${fmt(stop.offset)}, color = ${q(stop.color)} },`,
      );
    }
    lines.push("]");
  }
  if (fill.opacity !== undefined && fill.opacity < 1) {
    lines.push(`opacity = ${fmt(fill.opacity)}`);
  }
  lines.push("");
}

function serializeSticker(lines, sticker, index) {
  lines.push("[[stickers]]");
  lines.push(`kind = ${q(sticker.kind)}`);
  if (sticker.kind === "icon") {
    lines.push(`source = ${q(sticker.source)}`);
    if (sticker.color) lines.push(`color = ${q(sticker.color)}`);
    lines.push(`recolor = ${sticker.recolor ? "true" : "false"}`);
  } else {
    lines.push(`text = ${q(sticker.text)}`);
    lines.push(`font = ${q(sticker.font)}`);
    lines.push(`weight = ${fmt(sticker.weight)}`);
    lines.push(`color = ${q(sticker.color)}`);
  }
  lines.push(`x = ${fmt(sticker.x)}`);
  lines.push(`y = ${fmt(sticker.y)}`);
  if (sticker.offset_x) lines.push(`offset_x = ${fmt(sticker.offset_x)}`);
  if (sticker.offset_y) lines.push(`offset_y = ${fmt(sticker.offset_y)}`);
  lines.push(`scale = ${fmt(sticker.scale)}`);
  if (sticker.rotation) lines.push(`rotation = ${fmt(sticker.rotation)}`);
  if (sticker.opacity < 1) lines.push(`opacity = ${fmt(sticker.opacity)}`);
  lines.push("");
  lines.push("[stickers.stroke]");
  lines.push(`enabled = ${sticker.stroke.enabled ? "true" : "false"}`);
  lines.push(`color = ${q(sticker.stroke.color)}`);
  lines.push(`width = ${fmt(sticker.stroke.width)}`);
  if (sticker.stroke.opacity < 1) {
    lines.push(`opacity = ${fmt(sticker.stroke.opacity)}`);
  }
  lines.push("");
  lines.push("[stickers.shadow]");
  lines.push(`enabled = ${sticker.shadow.enabled ? "true" : "false"}`);
  lines.push(`color = ${q(sticker.shadow.color)}`);
  lines.push(`opacity = ${fmt(sticker.shadow.opacity)}`);
  lines.push(`blur = ${fmt(sticker.shadow.blur)}`);
  lines.push(`dx = ${fmt(sticker.shadow.dx)}`);
  lines.push(`dy = ${fmt(sticker.shadow.dy)}`);
  if (index !== undefined) lines.push("");
}

function serializeConfig(config) {
  const c = normalizeConfig(config);
  const lines = [
    "# ico-designer config",
    "# Visual editor: npm run editor",
    `schema = ${SCHEMA}`,
    `category = ${q(c.category)}`,
    `size = ${c.size}`,
    "",
  ];
  for (const key of ID_KEYS) {
    serializeFill(lines, key, c.ids[key]);
  }
  c.stickers.forEach((sticker, i) => serializeSticker(lines, sticker, i));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

module.exports = {
  SCHEMA,
  ID_KEYS,
  FILL_TYPES,
  DEFAULT_ID_COLORS,
  DEFAULT_FONT,
  defaultStops,
  normalizeFill,
  normalizeSticker,
  normalizeConfig,
  defaultConfig,
  serializeConfig,
  asciiOnly,
};
