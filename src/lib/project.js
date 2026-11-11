"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { parse } = require("smol-toml");
const { paths, configFile, configDir } = require("./paths");
const { defaultConfig, normalizeConfig, serializeConfig } = require("./config");
const { availableAssets, assetUrl, artUrl } = require("./assets");

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateName(name) {
  const value = String(name || "").trim();
  if (!NAME_RE.test(value)) {
    throw new Error(
      "Config name must start with a letter or digit and use only letters, digits, dot, dash or underscore",
    );
  }
  return value;
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

async function directorySignature(dir) {
  const parts = [];
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
      const stat = await fsp.stat(full);
      parts.push(`${rel}:${Math.round(stat.mtimeMs)}:${stat.size}`);
    }
  }
  try {
    await walk(dir, "");
  } catch {
    return "empty";
  }
  parts.sort();
  return crypto
    .createHash("sha1")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 12);
}

async function listCategories() {
  let entries = [];
  try {
    entries = await fsp.readdir(paths.res, { withFileTypes: true });
  } catch {
    return [];
  }
  const categories = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => {
      if (a === "doc-base") return -1;
      if (b === "doc-base") return 1;
      return a.localeCompare(b);
    });
  return categories.map((name) => ({ name }));
}

async function listConfigs() {
  let entries = [];
  try {
    entries = await fsp.readdir(paths.configs, { withFileTypes: true });
  } catch {
    return [];
  }
  const configs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".toml"))
      continue;
    const name = entry.name.slice(0, -5);
    if (name.startsWith(".")) continue;
    const file = configFile(name);
    try {
      const stat = await fsp.stat(file);
      const raw = await fsp.readFile(file, "utf8");
      const config = normalizeConfig(parse(raw));
      const assetSig = await directorySignature(configDir(name));
      configs.push({
        name,
        mtime: Math.round(stat.mtimeMs),
        category: config.category,
        size: config.size,
        assetSig,
        thumb: `/api/thumb/${encodeURIComponent(name)}.png?size=96&v=${Math.round(
          stat.mtimeMs,
        )}&a=${assetSig}`,
      });
    } catch (err) {
      configs.push({
        name,
        mtime: 0,
        category: null,
        size: null,
        thumb: null,
        error: err.message,
      });
    }
  }
  configs.sort((a, b) => a.name.localeCompare(b.name));
  return configs;
}

async function loadConfig(name) {
  const safeName = validateName(name);
  const file = configFile(safeName);
  let raw;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    throw new Error(`Config "${safeName}" not found`);
  }
  let parsed;
  try {
    parsed = parse(raw);
  } catch (err) {
    const error = new Error(`Invalid TOML in ${safeName}.toml: ${err.message}`);
    error.code = "TOML_PARSE";
    error.toml = raw;
    throw error;
  }
  const stat = await fsp.stat(file);
  return {
    name: safeName,
    file,
    toml: raw,
    config: normalizeConfig(parsed),
    mtime: Math.round(stat.mtimeMs),
  };
}

async function saveConfig(name, config) {
  const safeName = validateName(name);
  const toml = serializeConfig(config);
  await writeAtomic(configFile(safeName), toml);
  return loadConfig(safeName);
}

async function saveRawConfig(name, toml) {
  const safeName = validateName(name);
  if (typeof toml !== "string") throw new Error("TOML body must be a string");
  try {
    parse(toml);
  } catch (err) {
    const error = new Error(`Invalid TOML: ${err.message}`);
    error.code = "TOML_PARSE";
    throw error;
  }
  await writeAtomic(configFile(safeName), toml);
  return loadConfig(safeName);
}

async function copyTemplates(name) {
  const dir = configDir(name);
  await fsp.mkdir(dir, { recursive: true });
  let files = [];
  try {
    files = await fsp.readdir(paths.templates);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".svg")) continue;
    await fsp.copyFile(path.join(paths.templates, file), path.join(dir, file));
  }
}

async function createConfig(name, options = {}) {
  const safeName = validateName(name);
  if (await exists(configFile(safeName))) {
    throw new Error(`Config "${safeName}" already exists`);
  }
  const dir = configDir(safeName);
  await fsp.mkdir(dir, { recursive: true });

  if (options.duplicateOf) {
    const source = await loadConfig(options.duplicateOf);
    const sourceDir = configDir(source.name);
    if (await exists(sourceDir)) {
      await fsp.cp(sourceDir, dir, { recursive: true, force: true });
    }
    await writeAtomic(configFile(safeName), source.toml);
  } else {
    await writeAtomic(configFile(safeName), serializeConfig(defaultConfig()));
    await copyTemplates(safeName);
  }

  return loadConfig(safeName);
}

async function deleteConfig(name) {
  const safeName = validateName(name);
  const file = configFile(safeName);
  if (!(await exists(file))) throw new Error(`Config "${safeName}" not found`);
  await fsp.rm(file, { force: true });
  const dir = configDir(safeName);
  if (await exists(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  const artifact = path.join(paths.artifact, `${safeName}.png`);
  if (await exists(artifact)) {
    await fsp.rm(artifact, { force: true });
  }
  return { name: safeName };
}

async function listConfigAssets(name) {
  const safeName = validateName(name);
  const dir = configDir(safeName);
  const assets = await availableAssets(dir);
  return assets.map((asset) => ({
    ...asset,
    url:
      asset.kind === "art"
        ? artUrl(safeName, asset.file)
        : assetUrl(safeName, asset.file),
  }));
}

module.exports = {
  validateName,
  directorySignature,
  listCategories,
  listConfigs,
  loadConfig,
  saveConfig,
  saveRawConfig,
  createConfig,
  deleteConfig,
  listConfigAssets,
  configDir,
  configFile,
};
