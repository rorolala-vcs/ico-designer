"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sharp = require("sharp");
const { paths, isInside } = require("./paths");

const IMAGE_EXTS = [".png", ".svg", ".webp", ".jpg", ".jpeg", ".avif"];
const SVG_DENSITY = 288;
const CACHE_LIMIT = 96;

const rawCache = new Map();
const metaCache = new Map();
const pngCache = new Map();

function cacheGet(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(cache, key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  return value;
}

function isImageFile(file) {
  return IMAGE_EXTS.includes(path.extname(file).toLowerCase());
}

function assertInside(dir, file) {
  if (!isInside(path.resolve(dir), path.resolve(file))) {
    throw new Error(`Asset path escapes its folder: ${file}`);
  }
}

async function availableAssets(dir) {
  const out = [];
  async function walk(current, relBase) {
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (isImageFile(entry.name)) {
        out.push({
          file: rel,
          name: rel.slice(0, -ext.length),
          ext: ext.slice(1),
          kind: "image",
        });
        continue;
      }
      if (ext === ".toml" && /^art\/[^/]+\.toml$/i.test(rel)) {
        out.push({
          file: rel,
          name: rel.slice(0, -ext.length),
          ext: "toml",
          kind: "art",
        });
      }
    }
  }
  await walk(dir, "");
  return out.sort(
    (a, b) => a.name.localeCompare(b.name) || a.ext.localeCompare(b.ext),
  );
}

function findCaseInsensitive(dir, fileName) {
  try {
    const entries = fs.readdirSync(dir);
    const lower = fileName.toLowerCase();
    const hit = entries.find((e) => e.toLowerCase() === lower);
    return hit ? path.join(dir, hit) : null;
  } catch {
    return null;
  }
}

async function resolveAsset(dir, name) {
  const raw = String(name === undefined || name === null ? "" : name).trim();
  if (!raw) throw new Error("Asset name is empty");
  const target = path.resolve(dir, raw);
  assertInside(dir, target);

  const candidates = [target];
  if (!path.extname(raw)) {
    for (const ext of IMAGE_EXTS) candidates.push(target + ext);
    candidates.push(`${target}.toml`);
  }
  for (const candidate of candidates) {
    try {
      const stat = await fsp.stat(candidate);
      if (!stat.isFile()) continue;
      if (path.extname(candidate).toLowerCase() === ".toml") {
        const { ensureArtSvgFile } = require("./art");
        return await ensureArtSvgFile(candidate);
      }
      return candidate;
    } catch {
      // try next
    }
  }

  const fileName = path.basename(raw);
  const dirName = path.dirname(raw);
  const scanDir = path.resolve(dir, dirName);
  assertInside(dir, scanDir);
  const candidatesCI = [];
  if (!path.extname(fileName)) {
    for (const ext of IMAGE_EXTS) candidatesCI.push(fileName + ext);
    candidatesCI.push(`${fileName}.toml`);
  } else {
    candidatesCI.push(fileName);
  }
  for (const candidate of candidatesCI) {
    const hit = findCaseInsensitive(scanDir, candidate);
    if (hit) {
      if (path.extname(hit).toLowerCase() === ".toml") {
        const { ensureArtSvgFile } = require("./art");
        return await ensureArtSvgFile(hit);
      }
      return hit;
    }
  }

  const available = (await availableAssets(dir)).map((a) => a.file).join(", ");
  throw new Error(
    `Asset "${raw}" not found in ${path.basename(dir)}/${available ? ` (available: ${available})` : ""}`,
  );
}

async function resolveCategoryAsset(category, baseName) {
  const dir = path.join(paths.res, category);
  try {
    return await resolveAsset(dir, baseName);
  } catch (err) {
    if (category !== "doc-base") {
      try {
        return await resolveAsset(path.join(paths.res, "doc-base"), baseName);
      } catch {
        // throw the original, it describes the requested category
      }
    }
    throw err;
  }
}

async function imageMeta(file) {
  const stat = await fsp.stat(file);
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  const cached = cacheGet(metaCache, key);
  if (cached) return cached;
  const meta = await sharp(file).metadata();
  const value = {
    width: meta.width || 512,
    height: meta.height || 512,
    format: meta.format || path.extname(file).slice(1).toLowerCase(),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
  return cacheSet(metaCache, key, value);
}

/**
 * Rasterize any supported image into straight RGBA pixels.
 * `fit: 'fill'` stretches, `fit: 'contain'` letterboxes with transparency.
 */
async function rasterize(file, width, height, options = {}) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const fit = options.fit || "fill";
  const stat = await fsp.stat(file);
  const key = [file, stat.mtimeMs, stat.size, w, h, fit].join(":");
  const cached = cacheGet(rawCache, key);
  if (cached) return cached;

  const result = await sharp(file, { density: SVG_DENSITY })
    .resize(w, h, {
      fit,
      kernel: "lanczos3",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const value = {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: 4,
  };
  return cacheSet(rawCache, key, value);
}

/** Render an icon asset to a PNG buffer, preserving its aspect ratio. */
async function iconPng(file, maxSide) {
  const side = Math.max(8, Math.round(maxSide));
  const stat = await fsp.stat(file);
  const key = [file, stat.mtimeMs, stat.size, side].join(":");
  const cached = cacheGet(pngCache, key);
  if (cached) return cached;

  const meta = await imageMeta(file);
  const aspect = meta.width / meta.height || 1;
  const w = aspect >= 1 ? side : Math.max(1, Math.round(side * aspect));
  const h = aspect >= 1 ? Math.max(1, Math.round(side / aspect)) : side;
  const png = await sharp(file, { density: SVG_DENSITY })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return cacheSet(pngCache, key, { png, width: w, height: h, aspect });
}

function assetVersion(file) {
  try {
    const stat = fs.statSync(file);
    return `${Math.round(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return "0";
  }
}

function assetUrl(configName, file) {
  return `/api/asset?config=${encodeURIComponent(
    configName,
  )}&file=${encodeURIComponent(file)}&v=${assetVersion(
    path.join(paths.configs, configName, file),
  )}`;
}

function artUrl(configName, file) {
  const name = path.basename(file, ".toml");
  return `/api/art-svg?config=${encodeURIComponent(
    configName,
  )}&name=${encodeURIComponent(name)}&v=${assetVersion(
    path.join(paths.configs, configName, file),
  )}`;
}

module.exports = {
  IMAGE_EXTS,
  SVG_DENSITY,
  availableAssets,
  resolveAsset,
  resolveCategoryAsset,
  imageMeta,
  rasterize,
  iconPng,
  assetVersion,
  assetUrl,
  artUrl,
};
