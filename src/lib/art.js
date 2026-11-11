"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { parse } = require("smol-toml");
const { paths, configDir, isInside } = require("./paths");
const { getShape, SHAPE_VERSION } = require("./shapes");
const { normalizeHex, parseColor } = require("./colors");

const MIN_SIZE = 8;
const MAX_SIZE = 256;
const MAX_STYLES = 256;
const EMPTY = 0xffff;
const ART_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeRotation(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const snapped = Math.round(n / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function normalizeStyle(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    shape: getShape(src.shape).id,
    rotation: normalizeRotation(src.rotation),
    mirror: Boolean(src.mirror),
    color: normalizeHex(src.color, "#ffffff"),
  };
}

function normalizeArt(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const width = clampInt(src.width, MIN_SIZE, MAX_SIZE, 32);
  const height = clampInt(src.height, MIN_SIZE, MAX_SIZE, 32);
  const styles = Array.isArray(src.styles)
    ? src.styles.slice(0, MAX_STYLES).map(normalizeStyle)
    : [];
  const rows = [];
  for (let y = 0; y < height; y++) {
    const value = Array.isArray(src.rows) ? src.rows[y] : "";
    rows.push(typeof value === "string" ? value : "");
  }
  return { width, height, styles, rows };
}

function emptyArt(width = 32, height = 32) {
  return normalizeArt({ width, height, styles: [], rows: [] });
}

function parseGrid(art) {
  const width = art.width;
  const height = art.height;
  const cells = new Uint16Array(width * height);
  cells.fill(EMPTY);
  for (let y = 0; y < height; y++) {
    const row = art.rows[y] || "";
    for (let x = 0; x < width; x++) {
      const pair = row.slice(x * 2, x * 2 + 2);
      if (!/^[0-9a-f]{2}$/i.test(pair)) continue;
      const index = parseInt(pair, 16);
      if (!Number.isFinite(index) || index < 0 || index >= art.styles.length) {
        continue;
      }
      cells[y * width + x] = index;
    }
  }
  return cells;
}

function prune(cells, styles) {
  const used = new Set();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) used.add(cells[i]);
  }
  const map = new Map();
  const nextStyles = [];
  for (let i = 0; i < styles.length; i++) {
    if (!used.has(i)) continue;
    map.set(i, nextStyles.length);
    nextStyles.push(styles[i]);
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) cells[i] = map.get(cells[i]);
  }
  return nextStyles;
}

function encodeRows(cells, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const parts = [];
    for (let x = 0; x < width; x++) {
      const index = cells[y * width + x];
      parts.push(index === EMPTY ? ".." : index.toString(16).padStart(2, "0"));
    }
    let row = parts.join("");
    while (row.endsWith("..")) row = row.slice(0, -2);
    rows.push(row);
  }
  return rows;
}

function q(value) {
  return JSON.stringify(String(value));
}

function serializeArt(rawArt) {
  const art = normalizeArt(rawArt);
  const cells = parseGrid(art);
  const styles = prune(cells, art.styles);
  const rows = encodeRows(cells, art.width, art.height);
  const lines = [
    "# ico-designer grid art",
    '# each cell is two hex digits indexing [[styles]], ".." is empty',
    `width = ${art.width}`,
    `height = ${art.height}`,
    "rows = [",
  ];
  for (const row of rows) lines.push(`  ${q(row)},`);
  lines.push("]");
  styles.forEach((style) => {
    lines.push("");
    lines.push("[[styles]]");
    lines.push(`shape = ${q(style.shape)}`);
    lines.push(`rotation = ${style.rotation}`);
    lines.push(`mirror = ${style.mirror ? "true" : "false"}`);
    lines.push(`color = ${q(style.color)}`);
  });
  lines.push("");
  return lines.join("\n");
}

function svgColor(hex) {
  const [r, g, b, a] = parseColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function renderArtSvg(rawArt) {
  const art = normalizeArt(rawArt);
  const cells = parseGrid(art);
  const used = new Set();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) used.add(cells[i]);
  }
  const defs = [];
  const body = [];
  const defIds = new Map();
  let defIndex = 0;
  for (const index of used) {
    const style = art.styles[index];
    if (!style) continue;
    const shape = getShape(style.shape);
    if (shape.id === "square") continue;
    const id = `p${defIndex++}`;
    defIds.set(index, id);
    defs.push(
      `<path id="${id}" d="${shape.d}" fill-rule="${
        shape.fillRule || "nonzero"
      }"/>`,
    );
  }

  for (let y = 0; y < art.height; y++) {
    let x = 0;
    while (x < art.width) {
      const index = cells[y * art.width + x];
      if (index === EMPTY || !art.styles[index]) {
        x++;
        continue;
      }
      const style = art.styles[index];
      const shape = getShape(style.shape);
      if (shape.id === "square") {
        let run = 1;
        while (
          x + run < art.width &&
          cells[y * art.width + x + run] === index
        ) {
          run++;
        }
        body.push(
          `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${svgColor(
            style.color,
          )}"/>`,
        );
        x += run;
        continue;
      }
      const mirror = style.mirror ? -1 : 1;
      body.push(
        `<use href="#${defIds.get(index)}" xlink:href="#${defIds.get(
          index,
        )}" fill="${svgColor(style.color)}" transform="translate(${x + 0.5} ${
          y + 0.5
        }) rotate(${style.rotation}) scale(${mirror} 1) translate(-0.5 -0.5)"/>`,
      );
      x++;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}">${
    defs.length ? `<defs>${defs.join("")}</defs>` : ""
  }${body.join("")}</svg>`;
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

async function ensureArtSvgFile(tomlPath) {
  const raw = await fsp.readFile(tomlPath, "utf8");
  const art = normalizeArt(parse(raw));
  const svg = renderArtSvg(art);
  const hash = crypto
    .createHash("sha1")
    .update(`${SHAPE_VERSION}\n${svg}`)
    .digest("hex");
  const dir = path.join(paths.cache, "art");
  const cachePath = path.join(dir, `${hash}.svg`);
  try {
    await fsp.access(cachePath);
    return cachePath;
  } catch {
    // generate below
  }
  await fsp.mkdir(dir, { recursive: true });
  await writeAtomic(cachePath, svg);
  return cachePath;
}

function artDir(configName) {
  return path.join(configDir(configName), "art");
}

function artFile(configName, name) {
  const safe = String(name || "").trim();
  if (!ART_NAME_RE.test(safe)) {
    throw new Error(
      "Art name must start with a letter or digit and use only letters, digits, dot, dash or underscore",
    );
  }
  const file = path.join(artDir(configName), `${safe}.toml`);
  if (!isInside(configDir(configName), file)) {
    throw new Error("Invalid art path");
  }
  return file;
}

async function loadArt(configName, name) {
  const file = artFile(configName, name);
  let raw;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    throw new Error(`Art "${name}" not found`);
  }
  let parsed;
  try {
    parsed = parse(raw);
  } catch (err) {
    const error = new Error(`Invalid art TOML in ${name}.toml: ${err.message}`);
    error.code = "TOML_PARSE";
    throw error;
  }
  const stat = await fsp.stat(file);
  return {
    name,
    file,
    toml: raw,
    art: normalizeArt(parsed),
    mtime: Math.round(stat.mtimeMs),
  };
}

async function saveArt(configName, name, art) {
  const file = artFile(configName, name);
  await fsp.mkdir(artDir(configName), { recursive: true });
  await writeAtomic(file, serializeArt(art));
  return loadArt(configName, name);
}

async function saveArtToml(configName, name, toml) {
  const file = artFile(configName, name);
  if (typeof toml !== "string") throw new Error("TOML body must be a string");
  try {
    parse(toml);
  } catch (err) {
    const error = new Error(`Invalid art TOML: ${err.message}`);
    error.code = "TOML_PARSE";
    throw error;
  }
  await fsp.mkdir(artDir(configName), { recursive: true });
  await writeAtomic(file, toml);
  return loadArt(configName, name);
}

async function createArt(configName, name, width = 32, height = 32) {
  const file = artFile(configName, name);
  try {
    await fsp.access(file);
    throw new Error(`Art "${name}" already exists`);
  } catch (err) {
    if (err.message.includes("already exists")) throw err;
  }
  await fsp.mkdir(artDir(configName), { recursive: true });
  const art = emptyArt(
    clampInt(width, MIN_SIZE, MAX_SIZE, 32),
    clampInt(height, MIN_SIZE, MAX_SIZE, 32),
  );
  await writeAtomic(file, serializeArt(art));
  return loadArt(configName, name);
}

async function listArts(configName) {
  const dir = artDir(configName);
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".toml"))
      continue;
    if (entry.name.startsWith(".")) continue;
    const name = entry.name.slice(0, -5);
    if (!ART_NAME_RE.test(name)) continue;
    const file = path.join(dir, entry.name);
    try {
      const stat = await fsp.stat(file);
      const raw = await fsp.readFile(file, "utf8");
      const art = normalizeArt(parse(raw));
      out.push({
        name,
        file,
        width: art.width,
        height: art.height,
        mtime: Math.round(stat.mtimeMs),
        thumb: `/api/art-svg?config=${encodeURIComponent(
          configName,
        )}&name=${encodeURIComponent(name)}&v=${Math.round(stat.mtimeMs)}`,
      });
    } catch (err) {
      out.push({ name, file, mtime: 0, error: err.message, thumb: null });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function deleteArt(configName, name) {
  const file = artFile(configName, name);
  try {
    await fsp.access(file);
  } catch {
    throw new Error(`Art "${name}" not found`);
  }
  await fsp.rm(file, { force: true });
  const dir = artDir(configName);
  try {
    const rest = await fsp.readdir(dir);
    if (rest.length === 0) await fsp.rmdir(dir);
  } catch {
    // ignore
  }
  return { name };
}

module.exports = {
  MIN_SIZE,
  MAX_SIZE,
  MAX_STYLES,
  EMPTY,
  ART_NAME_RE,
  normalizeArt,
  emptyArt,
  parseGrid,
  serializeArt,
  renderArtSvg,
  ensureArtSvgFile,
  loadArt,
  saveArt,
  saveArtToml,
  createArt,
  listArts,
  deleteArt,
  artDir,
  artFile,
};
