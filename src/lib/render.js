"use strict";

const sharp = require("sharp");
const { ID_KEYS } = require("./config");
const { clamp, parseColor } = require("./colors");
const { configDir } = require("./paths");
const {
  resolveCategoryAsset,
  resolveAsset,
  rasterize,
  iconPng,
} = require("./assets");
const { buildFill } = require("./fill");

const RENDER_VERSION = "1.0.0";

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgColor(hex) {
  const [r, g, b, a] = parseColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function fontFamily(name) {
  const clean = String(name || "sans-serif")
    .replace(/["'<>,;\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${clean || "sans-serif"}, sans-serif`;
}

function colorizeBase(base, id, fills, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    const ba = base[i + 3] / 255;
    if (ba <= 0) continue;
    let r = base[i];
    let g = base[i + 1];
    let b = base[i + 2];

    if (id[i + 3] > 0) {
      const ir = id[i];
      const ig = id[i + 1];
      const ib = id[i + 2];
      const sum = ir + ig + ib;
      if (sum > 0) {
        const weights = [
          ["RedId", ir / sum],
          ["GreenId", ig / sum],
          ["BlueId", ib / sum],
        ];
        let pr = 0;
        let pg = 0;
        let pb = 0;
        let pa = 0;
        for (const [key, weight] of weights) {
          if (weight <= 1e-5) continue;
          const fill = fills[key];
          if (!fill) continue;
          const a = (fill[i + 3] / 255) * weight;
          if (a <= 0) continue;
          pr += fill[i] * a;
          pg += fill[i + 1] * a;
          pb += fill[i + 2] * a;
          pa += a;
        }
        if (pa > 1e-5) {
          const ea = Math.min(1, pa);
          r = (pr / pa) * ea + r * (1 - ea);
          g = (pg / pa) * ea + g * (1 - ea);
          b = (pb / pa) * ea + b * (1 - ea);
        }
      }
    }

    out[i] = Math.round(r);
    out[i + 1] = Math.round(g);
    out[i + 2] = Math.round(b);
    out[i + 3] = base[i + 3];
  }
  return out;
}

function overlayLayer(dst, src, size) {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) {
      dst[i + 3] = 0;
      continue;
    }
    dst[i] = Math.round((src[i] * sa + dst[i] * da * (1 - sa)) / oa);
    dst[i + 1] = Math.round(
      (src[i + 1] * sa + dst[i + 1] * da * (1 - sa)) / oa,
    );
    dst[i + 2] = Math.round(
      (src[i + 2] * sa + dst[i + 2] * da * (1 - sa)) / oa,
    );
    dst[i + 3] = Math.round(oa * 255);
  }
}

function stickerFilter(defId, sticker, size) {
  const strokeOn = sticker.stroke.enabled && sticker.stroke.width > 0;
  const shadow = sticker.shadow;
  const shadowOn =
    shadow.enabled &&
    shadow.opacity > 0 &&
    (shadow.blur > 0 || Math.abs(shadow.dx) > 0 || Math.abs(shadow.dy) > 0);
  const tintOn =
    sticker.kind === "icon" && sticker.recolor && Boolean(sticker.color);

  if (!strokeOn && !shadowOn && !tintOn) return null;

  const parts = [];
  let content = "SourceGraphic";

  if (tintOn) {
    parts.push(
      `<feFlood flood-color="${svgColor(sticker.color)}" result="tint${defId}"/>`,
      `<feComposite in="tint${defId}" in2="SourceAlpha" operator="in" result="tinted${defId}"/>`,
    );
    content = `tinted${defId}`;
  }

  let body = content;
  if (strokeOn) {
    const radius = clamp(sticker.stroke.width * size, 0.1, 96);
    parts.push(
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${radius.toFixed(2)}" result="dilate${defId}"/>`,
      `<feFlood flood-color="${svgColor(sticker.stroke.color)}" flood-opacity="${clamp(
        sticker.stroke.opacity,
        0,
        1,
      ).toFixed(3)}" result="strokeColor${defId}"/>`,
      `<feComposite in="strokeColor${defId}" in2="dilate${defId}" operator="in" result="stroke${defId}"/>`,
      `<feMerge result="body${defId}">`,
      `<feMergeNode in="stroke${defId}"/>`,
      `<feMergeNode in="${content}"/>`,
      `</feMerge>`,
    );
    body = `body${defId}`;
  }

  if (shadowOn) {
    const sigma = clamp((shadow.blur * size) / 2, 0, 128);
    const dx = clamp(shadow.dx * size, -512, 512);
    const dy = clamp(shadow.dy * size, -512, 512);
    parts.push(
      `<feGaussianBlur in="${body}" stdDeviation="${sigma.toFixed(2)}" result="blur${defId}"/>`,
      `<feOffset in="blur${defId}" dx="${dx.toFixed(2)}" dy="${dy.toFixed(
        2,
      )}" result="offset${defId}"/>`,
      `<feFlood flood-color="${svgColor(shadow.color)}" flood-opacity="${clamp(
        shadow.opacity,
        0,
        1,
      ).toFixed(3)}" result="shadowColor${defId}"/>`,
      `<feComposite in="shadowColor${defId}" in2="offset${defId}" operator="in" result="shadow${defId}"/>`,
      `<feMerge result="final${defId}">`,
      `<feMergeNode in="shadow${defId}"/>`,
      `<feMergeNode in="${body}"/>`,
      `</feMerge>`,
    );
    body = `final${defId}`;
  }

  return `<filter id="fx${defId}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">${parts.join(
    "",
  )}</filter>`;
}

async function stickerSvg(config, size, configDir) {
  const defs = [];
  const groups = [];
  let index = 0;

  for (const sticker of config.stickers) {
    if (!sticker || sticker.opacity <= 0) continue;
    let content = "";

    if (sticker.kind === "text") {
      if (!sticker.text) continue;
      const fontSize = clamp(sticker.scale * size, 1, size * 4);
      content = `<text x="0" y="${(fontSize * 0.35).toFixed(2)}" font-family="${xmlEscape(
        fontFamily(sticker.font),
      )}" font-size="${fontSize.toFixed(2)}" font-weight="${Math.round(
        sticker.weight,
      )}" fill="${svgColor(sticker.color)}" text-anchor="middle" xml:space="preserve">${xmlEscape(
        sticker.text,
      )}</text>`;
    } else {
      if (!sticker.source) continue;
      const file = await resolveAsset(configDir, sticker.source);
      const maxSide = clamp(sticker.scale * size, 1, size * 8);
      const png = await iconPng(file, maxSide * 2);
      const w = png.width / 2;
      const h = png.height / 2;
      const base64 = png.png.toString("base64");
      content = `<image x="${(-w / 2).toFixed(2)}" y="${(-h / 2).toFixed(
        2,
      )}" width="${w.toFixed(2)}" height="${h.toFixed(
        2,
      )}" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${base64}" href="data:image/png;base64,${base64}"/>`;
    }

    const defId = index++;
    const filter = stickerFilter(defId, sticker, size);
    if (filter) defs.push(filter);

    const cx = (sticker.x + sticker.offset_x) * size;
    const cy = (sticker.y + sticker.offset_y) * size;
    const inner = filter
      ? `<g filter="url(#fx${defId})">${content}</g>`
      : content;
    groups.push(
      `<g opacity="${clamp(sticker.opacity, 0, 1).toFixed(
        3,
      )}" transform="translate(${cx.toFixed(2)} ${cy.toFixed(
        2,
      )}) rotate(${sticker.rotation.toFixed(3)})">${inner}</g>`,
    );
  }

  if (groups.length === 0) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs.join(
    "",
  )}</defs>${groups.join("")}</svg>`;
}

/**
 * Render one config to a PNG buffer.
 * options: { configDir, size }
 */
async function renderConfig(config, options = {}) {
  const size = Math.max(1, Math.round(options.size || config.size || 512));
  const assetDir = options.configDir || configDir(options.name || "");
  const category = config.category;

  let baseFile;
  let idFile;
  let efxFile;
  try {
    [baseFile, idFile, efxFile] = await Promise.all([
      resolveCategoryAsset(category, "base"),
      resolveCategoryAsset(category, "id"),
      resolveCategoryAsset(category, "efx"),
    ]);
  } catch (err) {
    throw new Error(
      `Category "${category}" is missing an asset: ${err.message}`,
    );
  }

  const [base, id, efx, ...fills] = await Promise.all([
    rasterize(baseFile, size, size, { fit: "fill" }),
    rasterize(idFile, size, size, { fit: "fill" }),
    rasterize(efxFile, size, size, { fit: "fill" }),
    ...ID_KEYS.map((key) =>
      buildFill(config.ids[key], size, { configDir: assetDir }),
    ),
  ]);

  const fillByKey = {};
  ID_KEYS.forEach((key, i) => {
    fillByKey[key] = fills[i];
  });

  const out = colorizeBase(base.data, id.data, fillByKey, size);
  overlayLayer(out, efx.data, size);

  const svg = await stickerSvg(config, size, assetDir);
  if (svg) {
    const sticker = await sharp(Buffer.from(svg), { density: 288 })
      .resize(size, size, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    overlayLayer(out, sticker.data, size);
  }

  return sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = { renderConfig, RENDER_VERSION, colorizeBase, overlayLayer };
