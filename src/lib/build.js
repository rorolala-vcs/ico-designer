"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { paths, configDir } = require("./paths");
const { loadConfig, listConfigs } = require("./project");
const { renderConfig, RENDER_VERSION } = require("./render");
const { resolveCategoryAsset, resolveAsset } = require("./assets");

const MANIFEST = path.join(paths.artifact, ".manifest.json");

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function statKey(file) {
  try {
    const stat = await fsp.stat(file);
    return `${Math.round(stat.mtimeMs)}:${stat.size}`;
  } catch {
    return "missing";
  }
}

async function dependencyFiles(config, dir) {
  const deps = [];
  for (const name of ["base", "id", "efx"]) {
    try {
      deps.push(await resolveCategoryAsset(config.category, name));
    } catch (err) {
      deps.push(`!missing:${config.category}/${name}`);
    }
  }
  for (const key of Object.keys(config.ids || {})) {
    const fill = config.ids[key];
    if (fill && fill.type === "pattern" && fill.source) {
      try {
        deps.push(await resolveAsset(dir, fill.source));
      } catch {
        deps.push(`!missing:pattern/${fill.source}`);
      }
    }
  }
  for (const sticker of config.stickers || []) {
    if (sticker.kind === "icon" && sticker.source) {
      try {
        deps.push(await resolveAsset(dir, sticker.source));
      } catch {
        deps.push(`!missing:icon/${sticker.source}`);
      }
    }
  }
  return deps;
}

async function fingerprint(config, toml, dir) {
  const deps = await dependencyFiles(config, dir);
  const parts = [RENDER_VERSION, config.category, String(config.size), toml];
  for (const dep of deps) {
    parts.push(dep, dep.startsWith("!missing:") ? "" : await statKey(dep));
  }
  return sha256(parts.join("\n"));
}

async function readManifest() {
  try {
    const raw = await fsp.readFile(MANIFEST, "utf8");
    const data = JSON.parse(raw);
    if (data && data.items && typeof data.items === "object") return data;
  } catch {
    // ignore
  }
  return { version: 1, items: {} };
}

async function writeManifest(manifest) {
  await fsp.mkdir(paths.artifact, { recursive: true });
  const tmp = `${MANIFEST}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await fsp.rename(tmp, MANIFEST);
}

async function writePng(file, buffer) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, file);
}

/**
 * Incrementally render configs to artifact/<name>.png.
 * options: { names?: string[], force?: boolean, log?: (msg) => void }
 */
async function generate(options = {}) {
  const log = options.log || (() => {});
  await fsp.mkdir(paths.artifact, { recursive: true });

  const all = await listConfigs();
  const allNames = new Set(all.map((c) => c.name));
  const requested =
    Array.isArray(options.names) && options.names.length > 0
      ? options.names
      : Array.from(allNames);

  const manifest = await readManifest();
  const results = [];

  for (const name of requested) {
    const started = Date.now();
    try {
      if (!allNames.has(name)) {
        throw new Error(`Config "${name}" not found`);
      }
      const loaded = await loadConfig(name);
      const dir = configDir(name);
      const fp = await fingerprint(loaded.config, loaded.toml, dir);
      const outFile = path.join(paths.artifact, `${name}.png`);
      const previous = manifest.items[name];

      if (
        !options.force &&
        previous &&
        previous.fingerprint === fp &&
        fs.existsSync(outFile)
      ) {
        results.push({ name, status: "skipped", ms: Date.now() - started });
        log(`· ${name} (unchanged)`);
        continue;
      }

      const png = await renderConfig(loaded.config, {
        size: loaded.config.size,
        configDir: dir,
        name,
      });
      await writePng(outFile, png);
      manifest.items[name] = {
        fingerprint: fp,
        generatedAt: new Date().toISOString(),
        size: loaded.config.size,
      };
      await writeManifest(manifest);
      const status = previous ? "updated" : "created";
      results.push({ name, status, ms: Date.now() - started });
      log(`✓ ${name}.png (${status}, ${Date.now() - started}ms)`);
    } catch (err) {
      results.push({
        name,
        status: "error",
        error: err.message,
        ms: Date.now() - started,
      });
      log(`✗ ${name}: ${err.message}`);
    }
  }

  // Drop manifest entries whose TOML no longer exists.
  let pruned = false;
  for (const name of Object.keys(manifest.items)) {
    if (!allNames.has(name)) {
      delete manifest.items[name];
      pruned = true;
    }
  }
  if (pruned) await writeManifest(manifest);

  const summary = {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
  };
  return { results, summary };
}

module.exports = { generate, fingerprint, MANIFEST };
