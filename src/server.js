"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const sharp = require("sharp");
const { paths, configDir, isInside } = require("./lib/paths");
const project = require("./lib/project");
const { renderConfig, RENDER_VERSION } = require("./lib/render");
const { generate } = require("./lib/build");
const { listFonts, defaultFont } = require("./lib/fonts");
const { normalizeConfig } = require("./lib/config");
const { clamp } = require("./lib/colors");
const { resolveCategoryAsset } = require("./lib/assets");
const art = require("./lib/art");
const { shapeGroups, SHAPE_VERSION } = require("./lib/shapes");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".toml": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const thumbCache = new Map();
const THUMB_LIMIT = 160;
const categoryAssetCache = new Map();
const CATEGORY_ASSET_LIMIT = 18;
const artSvgCache = new Map();
const ART_SVG_LIMIT = 32;

let activeRenders = 0;
const renderWaiters = [];

function withRenderSlot(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      activeRenders++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          activeRenders--;
          const next = renderWaiters.shift();
          if (next) next();
        });
    };
    if (activeRenders < 2) start();
    else renderWaiters.push(start);
  });
}

function sendJson(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendBuffer(res, status, body, type, headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function cacheThumb(key, buffer) {
  thumbCache.set(key, buffer);
  while (thumbCache.size > THUMB_LIMIT) {
    thumbCache.delete(thumbCache.keys().next().value);
  }
}

function clearThumbs(name) {
  for (const key of Array.from(thumbCache.keys())) {
    if (key.startsWith(`${name}:`)) thumbCache.delete(key);
  }
}

async function serveStatic(res, file) {
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    sendError(res, 404, "Not found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  sendBuffer(res, 200, data, MIME[ext] || "application/octet-stream");
}

async function serveAsset(res, configName, fileName) {
  const safeName = project.validateName(configName);
  const dir = configDir(safeName);
  const target = path.resolve(dir, fileName);
  if (!isInside(dir, target)) {
    sendError(res, 400, "Invalid asset path");
    return;
  }
  let data;
  try {
    data = await fsp.readFile(target);
  } catch {
    sendError(res, 404, "Asset not found");
    return;
  }
  const ext = path.extname(target).toLowerCase();
  sendBuffer(res, 200, data, MIME[ext] || "application/octet-stream", {
    "Cache-Control": "public, max-age=60",
  });
}

async function renderThumb(name, size) {
  const loaded = await project.loadConfig(name);
  const assetSig = await project.directorySignature(configDir(name));
  const key = `${name}:${loaded.mtime}:${size}:${RENDER_VERSION}:${assetSig}`;
  const cached = thumbCache.get(key);
  if (cached) {
    thumbCache.delete(key);
    thumbCache.set(key, cached);
    return cached;
  }
  const buffer = await withRenderSlot(() =>
    renderConfig(loaded.config, {
      size,
      configDir: configDir(name),
      name,
    }),
  );
  cacheThumb(key, buffer);
  return buffer;
}

async function route(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || "GET";

  if (method === "GET" || method === "HEAD") {
    if (pathname === "/" || pathname === "/index.html") {
      await serveStatic(res, path.join(paths.editor, "index.html"));
      return;
    }
    if (pathname === "/app.js") {
      await serveStatic(res, path.join(paths.editor, "app.js"));
      return;
    }
    if (pathname === "/renderer.js") {
      await serveStatic(res, path.join(paths.editor, "renderer.js"));
      return;
    }
    if (pathname === "/color-picker.js") {
      await serveStatic(res, path.join(paths.editor, "color-picker.js"));
      return;
    }
    if (pathname === "/art-studio.js") {
      await serveStatic(res, path.join(paths.editor, "art-studio.js"));
      return;
    }
    if (pathname === "/style.css") {
      await serveStatic(res, path.join(paths.editor, "style.css"));
      return;
    }
  }

  if (pathname === "/api/meta" && method === "GET") {
    const [categories, fonts, preferred] = await Promise.all([
      project.listCategories(),
      listFonts(),
      defaultFont(),
    ]);
    sendJson(res, 200, {
      categories,
      fonts,
      defaultFont: preferred,
      renderVersion: RENDER_VERSION,
    });
    return;
  }

  if (pathname === "/api/fonts" && method === "GET") {
    sendJson(res, 200, { fonts: await listFonts() });
    return;
  }

  if (pathname === "/api/configs" && method === "GET") {
    sendJson(res, 200, { configs: await project.listConfigs() });
    return;
  }

  if (pathname === "/api/shapes" && method === "GET") {
    sendJson(res, 200, { version: SHAPE_VERSION, groups: shapeGroups() });
    return;
  }

  if (pathname === "/api/arts" && method === "GET") {
    const config = project.validateName(url.searchParams.get("config") || "");
    sendJson(res, 200, { arts: await art.listArts(config) });
    return;
  }

  if (pathname === "/api/art") {
    if (method === "GET") {
      const config = project.validateName(url.searchParams.get("config") || "");
      const name = url.searchParams.get("name") || "";
      sendJson(res, 200, await art.loadArt(config, name));
      return;
    }
    if (method === "POST") {
      const body = await readJson(req);
      const config = project.validateName(body.config || "");
      const created = await art.createArt(
        config,
        body.name,
        body.width,
        body.height,
      );
      clearThumbs(config);
      sendJson(res, 201, created);
      return;
    }
    if (method === "PUT") {
      const config = project.validateName(url.searchParams.get("config") || "");
      const name = url.searchParams.get("name") || "";
      const body = await readJson(req);
      let saved;
      if (typeof body.toml === "string") {
        saved = await art.saveArtToml(config, name, body.toml);
      } else {
        saved = await art.saveArt(config, name, body.art);
      }
      clearThumbs(config);
      sendJson(res, 200, saved);
      return;
    }
    if (method === "DELETE") {
      const config = project.validateName(url.searchParams.get("config") || "");
      const name = url.searchParams.get("name") || "";
      const removed = await art.deleteArt(config, name);
      clearThumbs(config);
      sendJson(res, 200, removed);
      return;
    }
  }

  if (pathname === "/api/art-svg" && method === "GET") {
    const config = project.validateName(url.searchParams.get("config") || "");
    const name = url.searchParams.get("name") || "";
    const loaded = await art.loadArt(config, name);
    const key = `${loaded.file}:${loaded.mtime}`;
    let svg = artSvgCache.get(key);
    if (!svg) {
      svg = Buffer.from(art.renderArtSvg(loaded.art));
      artSvgCache.set(key, svg);
      while (artSvgCache.size > ART_SVG_LIMIT) {
        artSvgCache.delete(artSvgCache.keys().next().value);
      }
    }
    sendBuffer(res, 200, svg, "image/svg+xml", {
      "Cache-Control": "no-cache",
    });
    return;
  }

  if (pathname === "/api/assets" && method === "GET") {
    const name = url.searchParams.get("config") || "";
    sendJson(res, 200, { assets: await project.listConfigAssets(name) });
    return;
  }

  if (pathname === "/api/config" && method === "POST") {
    const body = await readJson(req);
    const name = body.name;
    const created = await project.createConfig(name, {
      duplicateOf: body.duplicateOf,
    });
    clearThumbs(created.name);
    sendJson(res, 201, created);
    return;
  }

  if (pathname === "/api/generate" && method === "POST") {
    const body = await readJson(req);
    const result = await generate({
      names: Array.isArray(body.names) ? body.names : undefined,
      force: Boolean(body.force),
    });
    sendJson(res, 200, result);
    return;
  }

  if (pathname === "/api/render" && method === "POST") {
    const body = await readJson(req);
    const config = normalizeConfig(body.config);
    const size = Math.round(
      clamp(Number(body.size) || config.size || 512, 16, 2048),
    );
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const name = rawName ? project.validateName(rawName) : "";
    try {
      const png = await withRenderSlot(() =>
        renderConfig(config, {
          size,
          configDir: configDir(name),
          name,
        }),
      );
      sendBuffer(res, 200, png, "image/png");
    } catch (err) {
      sendError(res, 422, err.message);
    }
    return;
  }

  if (pathname === "/api/asset" && method === "GET") {
    await serveAsset(
      res,
      url.searchParams.get("config") || "",
      url.searchParams.get("file") || "",
    );
    return;
  }

  if (pathname === "/api/category-asset" && method === "GET") {
    const category = url.searchParams.get("category") || "doc-base";
    const file = url.searchParams.get("file") || "base";
    if (!/^[A-Za-z0-9_-]+$/.test(category) || !/^[A-Za-z0-9_.-]+$/.test(file)) {
      sendError(res, 400, "Invalid category asset request");
      return;
    }
    const size = Math.round(
      clamp(Number(url.searchParams.get("size")) || 0, 0, 2048),
    );
    try {
      const target = await resolveCategoryAsset(category, file);
      if (size >= 16) {
        const stat = await fsp.stat(target);
        const key = `${target}:${stat.mtimeMs}:${stat.size}:${size}`;
        let buffer = categoryAssetCache.get(key);
        if (!buffer) {
          buffer = await sharp(target, { density: 288 })
            .resize(size, size, { fit: "fill", kernel: "lanczos3" })
            .png({ compressionLevel: 9 })
            .toBuffer();
          categoryAssetCache.set(key, buffer);
          while (categoryAssetCache.size > CATEGORY_ASSET_LIMIT) {
            categoryAssetCache.delete(categoryAssetCache.keys().next().value);
          }
        }
        sendBuffer(res, 200, buffer, "image/png", {
          "Cache-Control": "no-cache",
        });
        return;
      }
      const data = await fsp.readFile(target);
      const ext = path.extname(target).toLowerCase();
      sendBuffer(res, 200, data, MIME[ext] || "application/octet-stream", {
        "Cache-Control": "no-cache",
      });
    } catch (err) {
      sendError(res, 404, err.message);
    }
    return;
  }

  const thumbMatch = pathname.match(/^\/api\/thumb\/([^/]+)\.png$/);
  if (thumbMatch && method === "GET") {
    const name = thumbMatch[1];
    const size = Math.round(
      clamp(Number(url.searchParams.get("size")) || 96, 16, 512),
    );
    try {
      const png = await renderThumb(name, size);
      sendBuffer(res, 200, png, "image/png", {
        "Cache-Control": "public, max-age=60",
      });
    } catch (err) {
      sendError(res, 422, err.message);
    }
    return;
  }

  const configMatch = pathname.match(/^\/api\/config\/([^/]+)(\/raw)?$/);
  if (configMatch) {
    const name = configMatch[1];
    const isRaw = Boolean(configMatch[2]);
    if (method === "GET") {
      try {
        const loaded = await project.loadConfig(name);
        sendJson(res, 200, isRaw ? { name, toml: loaded.toml } : loaded);
      } catch (err) {
        sendJson(res, err.code === "TOML_PARSE" ? 422 : 404, {
          error: err.message,
          toml: err.toml,
        });
      }
      return;
    }
    if (method === "PUT" && !isRaw) {
      const body = await readJson(req);
      let saved;
      if (typeof body.toml === "string") {
        saved = await project.saveRawConfig(name, body.toml);
      } else if (body.config) {
        saved = await project.saveConfig(name, normalizeConfig(body.config));
      } else {
        sendError(res, 400, 'Expected "config" or "toml"');
        return;
      }
      clearThumbs(name);
      sendJson(res, 200, saved);
      return;
    }
    if (method === "DELETE" && !isRaw) {
      const removed = await project.deleteConfig(name);
      clearThumbs(name);
      sendJson(res, 200, removed);
      return;
    }
  }

  sendError(res, 404, `No route for ${method} ${pathname}`);
}

function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve()
      .then(() => route(req, res))
      .catch((err) => {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const status = err.code === "TOML_PARSE" ? 422 : 400;
        sendJson(res, status, { error: err.message, toml: err.toml });
      });
  });
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function startServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const desiredPort = Number.isFinite(options.port) ? options.port : 5173;
  const server = createServer();
  let address = null;
  let lastError = null;
  const attempts = desiredPort === 0 ? 1 : 24;
  for (let i = 0; i < attempts; i++) {
    try {
      address = await listenOnce(server, desiredPort + i, host);
      break;
    } catch (err) {
      lastError = err;
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  if (!address) throw lastError || new Error("Could not bind a port");
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return {
    server,
    host,
    port: address.port,
    url: `http://${displayHost}:${address.port}/`,
  };
}

module.exports = { createServer, startServer };
