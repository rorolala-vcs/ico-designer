"use strict";

(function () {
  const TAU = Math.PI * 2;
  const ID_KEYS = ["RedId", "BlueId", "GreenId"];
  const ID_CHANNEL = ["r", "g", "b"];

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function clamp01(n) {
    return clamp(n, 0, 1);
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function parseColor(value) {
    let s = String(value || "")
      .trim()
      .toLowerCase();
    if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s)) {
      return {
        r: parseInt(s[0] + s[0], 16),
        g: parseInt(s[1] + s[1], 16),
        b: parseInt(s[2] + s[2], 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{4}$/.test(s)) {
      return {
        r: parseInt(s[0] + s[0], 16),
        g: parseInt(s[1] + s[1], 16),
        b: parseInt(s[2] + s[2], 16),
        a: parseInt(s[3] + s[3], 16) / 255,
      };
    }
    if (/^[0-9a-f]{6}$/.test(s)) {
      return {
        r: parseInt(s.slice(0, 2), 16),
        g: parseInt(s.slice(2, 4), 16),
        b: parseInt(s.slice(4, 6), 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{8}$/.test(s)) {
      return {
        r: parseInt(s.slice(0, 2), 16),
        g: parseInt(s.slice(2, 4), 16),
        b: parseInt(s.slice(4, 6), 16),
        a: parseInt(s.slice(6, 8), 16) / 255,
      };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  function cssColor(color) {
    const c = typeof color === "string" ? parseColor(color) : color;
    return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(
      c.b,
    )}, ${clamp01(c.a)})`;
  }

  function quoteFont(name) {
    const clean = String(name || "sans-serif")
      .replace(/["'<>,;\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `"${clean || "sans-serif"}", sans-serif`;
  }

  function loadImage(url) {
    if (loadImage.cache.has(url)) return loadImage.cache.get(url);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
    loadImage.cache.set(url, promise);
    promise.catch(() => loadImage.cache.delete(url));
    return promise;
  }
  loadImage.cache = new Map();

  function rasterizeCache() {
    if (!rasterize.cache) rasterize.cache = new Map();
    return rasterize.cache;
  }

  function rasterize(img, width, height, fit) {
    const cache = rasterizeCache();
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const key = `${img.src}|${w}x${h}|${fit || "fill"}`;
    if (rasterize.cache.has(key)) return rasterize.cache.get(key);
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (fit === "contain") {
      const scale = Math.min(
        w / (img.naturalWidth || w),
        h / (img.naturalHeight || h),
      );
      const dw = Math.max(1, Math.round((img.naturalWidth || w) * scale));
      const dh = Math.max(1, Math.round((img.naturalHeight || h) * scale));
      ctx.drawImage(
        img,
        Math.round((w - dw) / 2),
        Math.round((h - dh) / 2),
        dw,
        dh,
      );
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }
    const entry = { canvas, data: ctx.getImageData(0, 0, w, h) };
    rasterize.cache.set(key, entry);
    while (rasterize.cache.size > 12) {
      rasterize.cache.delete(rasterize.cache.keys().next().value);
    }
    return entry;
  }

  function findAsset(assets, name) {
    if (!name) return null;
    const needle = String(name).toLowerCase();
    return (
      (assets || []).find((a) => a.name.toLowerCase() === needle) ||
      (assets || []).find((a) => a.file.toLowerCase() === needle) ||
      null
    );
  }

  function missingAsset(name, configName) {
    return new Error(
      `Asset "${name || "?"}" not found in ${
        configName ? `configs/${configName}/` : "the config folder"
      }`,
    );
  }

  function categoryAssetUrl(category, file, size) {
    return `/api/category-asset?category=${encodeURIComponent(
      category,
    )}&file=${encodeURIComponent(file)}&size=${Math.round(size || 0)}`;
  }

  function compileStops(stops) {
    return (stops || [])
      .map((stop) => ({
        offset: clamp01(Number(stop.offset) || 0),
        color: parseColor(stop.color),
      }))
      .sort((a, b) => a.offset - b.offset);
  }

  function sampleStops(stops, t) {
    const tt = clamp01(t);
    if (tt <= stops[0].offset) return stops[0].color;
    const last = stops[stops.length - 1];
    if (tt >= last.offset) return last.color;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1];
      const b = stops[i];
      if (tt <= b.offset) {
        const span = b.offset - a.offset;
        const f = span <= 1e-6 ? 0 : (tt - a.offset) / span;
        return {
          r: a.color.r + (b.color.r - a.color.r) * f,
          g: a.color.g + (b.color.g - a.color.g) * f,
          b: a.color.b + (b.color.b - a.color.b) * f,
          a: a.color.a + (b.color.a - a.color.a) * f,
        };
      }
    }
    return last.color;
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
    return Math.hypot(u, v) / Math.max(radius || 0.72, 1e-6);
  }

  function conicT(x, y, size, cx, cy, angleDeg) {
    const u = (x + 0.5) / size - cx;
    const v = (y + 0.5) / size - cy;
    const a = Math.atan2(u, -v);
    const start = (angleDeg * Math.PI) / 180;
    return ((((a - start) / TAU) % 1) + 1) % 1;
  }

  function buildSolid(fill, size) {
    const color = parseColor(fill.color);
    const opacity = fill.opacity === undefined ? 1 : fill.opacity;
    const data = new ImageData(size, size);
    const out = data.data;
    const r = Math.round(color.r);
    const g = Math.round(color.g);
    const b = Math.round(color.b);
    const a = Math.round(clamp01(color.a * opacity) * 255);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
    return data;
  }

  function buildGradient(fill, size) {
    const stops = compileStops(fill.stops);
    if (!stops.length) return new ImageData(size, size);
    const opacity = fill.opacity === undefined ? 1 : fill.opacity;
    const data = new ImageData(size, size);
    const out = data.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let t = 0;
        if (fill.type === "linear") {
          t = linearT(x, y, size, fill.angle || 0);
        } else if (fill.type === "radial") {
          t = radialT(x, y, size, fill.cx ?? 0.5, fill.cy ?? 0.5, fill.radius);
        } else {
          t = conicT(
            x,
            y,
            size,
            fill.cx ?? 0.5,
            fill.cy ?? 0.5,
            fill.angle || 0,
          );
        }
        const c = sampleStops(stops, t);
        const i = (y * size + x) * 4;
        out[i] = Math.round(c.r);
        out[i + 1] = Math.round(c.g);
        out[i + 2] = Math.round(c.b);
        out[i + 3] = Math.round(clamp01(c.a * opacity) * 255);
      }
    }
    return data;
  }

  class IconPreviewRenderer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.size = Math.max(16, Math.round(options.size || 640));
      this.canvas.width = this.size;
      this.canvas.height = this.size;
      this.ctx = canvas.getContext("2d");
      this.seq = 0;
      this.pending = null;
      this.running = false;
      this.categoryCache = new Map();
      this.fillCache = new Map();
      this.baseCache = null;
      this.measureCanvas = makeCanvas(8, 8);
      this.measureCtx = this.measureCanvas.getContext("2d");
    }

    cancel() {
      if (this.pending) {
        this.pending.resolve(false);
        this.pending = null;
      }
      this.seq++;
      this.ctx.clearRect(0, 0, this.size, this.size);
    }

    render(config, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.pending) this.pending.resolve(false);
        this.pending = {
          id: ++this.seq,
          config,
          options,
          resolve,
          reject,
        };
        if (!this.running) {
          this.running = true;
          this.drain();
        }
      });
    }

    async drain() {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        try {
          const drew = await this.renderJob(job);
          job.resolve(Boolean(drew));
        } catch (err) {
          job.reject(err);
        }
      }
      this.running = false;
    }

    async renderJob(job) {
      if (job.id !== this.seq) return false;
      const { config, options } = job;
      const size = this.size;
      const base = await this.getBase(config, size, options);
      if (job.id !== this.seq) return false;

      const ctx = this.ctx;
      ctx.save();
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(base, 0, 0);
      ctx.restore();

      for (const sticker of config.stickers || []) {
        if (job.id !== this.seq) return false;
        await this.drawSticker(ctx, sticker, size, options);
      }
      return true;
    }

    async loadCategory(category) {
      if (category === undefined || category === null) category = "doc-base";
      if (this.categoryCache.has(category))
        return this.categoryCache.get(category);
      const promise = Promise.all([
        loadImage(categoryAssetUrl(category, "base", this.size)),
        loadImage(categoryAssetUrl(category, "id", this.size)),
        loadImage(categoryAssetUrl(category, "efx", this.size)),
      ]).then(([base, id, efx]) => ({ base, id, efx }));
      this.categoryCache.set(category, promise);
      promise.catch(() => this.categoryCache.delete(category));
      return promise;
    }

    fillKey(fill, size, options) {
      if (!fill) return "none";
      let extra = "";
      if (fill.type === "pattern") {
        const asset = findAsset(options.assets, fill.source);
        extra = `|${asset ? asset.url : `missing:${fill.source}`}`;
      }
      return `${JSON.stringify(fill)}|${size}${extra}`;
    }

    async getFill(fill, size, options) {
      if (!fill) return new ImageData(size, size);
      const key = this.fillKey(fill, size, options);
      if (this.fillCache.has(key)) {
        const value = this.fillCache.get(key);
        this.fillCache.delete(key);
        this.fillCache.set(key, value);
        return value;
      }
      let data;
      if (fill.type === "solid") {
        data = buildSolid(fill, size);
      } else if (fill.type === "pattern") {
        data = await this.buildPattern(fill, size, options);
      } else {
        data = buildGradient(fill, size);
      }
      this.fillCache.set(key, data);
      while (this.fillCache.size > 30) {
        this.fillCache.delete(this.fillCache.keys().next().value);
      }
      return data;
    }

    async buildPattern(fill, size, options) {
      const asset = findAsset(options.assets, fill.source);
      if (!asset) throw missingAsset(fill.source, options.configName);
      const img = await loadImage(asset.url);
      const tileSize = clamp(
        Math.round((fill.scale || 0.25) * size),
        4,
        size * 4,
      );
      const tile = rasterize(img, tileSize, tileSize, "contain");
      const tw = tile.canvas.width;
      const th = tile.canvas.height;
      const ox = Math.round((fill.offset_x || 0) * size);
      const oy = Math.round((fill.offset_y || 0) * size);
      const opacity = fill.opacity === undefined ? 1 : fill.opacity;
      const data = new ImageData(size, size);
      const out = data.data;
      const src = tile.data.data;
      for (let y = 0; y < size; y++) {
        const sy = (((y - oy) % th) + th) % th;
        for (let x = 0; x < size; x++) {
          const sx = (((x - ox) % tw) + tw) % tw;
          const si = (sy * tw + sx) * 4;
          const di = (y * size + x) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = Math.round(src[si + 3] * opacity);
        }
      }
      return data;
    }

    async getBase(config, size, options) {
      const keys = ID_KEYS.map((key) =>
        this.fillKey(config.ids[key], size, options),
      );
      const baseKey = `${config.category}|${size}|${keys.join("~")}`;
      if (this.baseCache && this.baseCache.key === baseKey) {
        return this.baseCache.canvas;
      }

      const category = await this.loadCategory(config.category);
      const [baseRaster, idRaster] = await Promise.all([
        Promise.resolve(rasterize(category.base, size, size)),
        Promise.resolve(rasterize(category.id, size, size)),
      ]);
      const efx = rasterize(category.efx, size, size).canvas;
      const fills = {};
      for (const key of ID_KEYS) {
        fills[key] = await this.getFill(config.ids[key], size, options);
      }

      const baseData = baseRaster.data.data;
      const idData = idRaster.data.data;
      const out = new ImageData(size, size);
      const dst = out.data;
      for (let i = 0; i < dst.length; i += 4) {
        const ba = baseData[i + 3] / 255;
        if (ba <= 0) continue;
        let r = baseData[i];
        let g = baseData[i + 1];
        let b = baseData[i + 2];

        if (idData[i + 3] > 0) {
          const ir = idData[i];
          const ig = idData[i + 1];
          const ib = idData[i + 2];
          const sum = ir + ig + ib;
          if (sum > 0) {
            let pr = 0;
            let pg = 0;
            let pb = 0;
            let pa = 0;
            const weights = [
              ["RedId", ir / sum],
              ["GreenId", ig / sum],
              ["BlueId", ib / sum],
            ];
            for (const [key, weight] of weights) {
              if (weight <= 1e-5) continue;
              const fill = fills[key];
              if (!fill) continue;
              const a = (fill.data[i + 3] / 255) * weight;
              if (a <= 0) continue;
              pr += fill.data[i] * a;
              pg += fill.data[i + 1] * a;
              pb += fill.data[i + 2] * a;
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

        dst[i] = Math.round(r);
        dst[i + 1] = Math.round(g);
        dst[i + 2] = Math.round(b);
        dst[i + 3] = baseData[i + 3];
      }

      const canvas = makeCanvas(size, size);
      const ctx = canvas.getContext("2d");
      ctx.putImageData(out, 0, 0);
      ctx.drawImage(efx, 0, 0);
      this.baseCache = { key: baseKey, canvas };
      return canvas;
    }

    async drawSticker(ctx, sticker, size, options) {
      if (!sticker || sticker.opacity <= 0) return;
      const content = await this.buildStickerContent(sticker, size, options);
      if (!content) return;

      const cx = (sticker.x + (sticker.offset_x || 0)) * size;
      const cy = (sticker.y + (sticker.offset_y || 0)) * size;
      const rad = ((sticker.rotation || 0) * Math.PI) / 180;
      const shadow = sticker.shadow;
      const shadowOn =
        shadow &&
        shadow.enabled &&
        shadow.opacity > 0 &&
        (shadow.blur > 0 || Math.abs(shadow.dx) > 0 || Math.abs(shadow.dy) > 0);

      let drawable = content.canvas;
      if (shadowOn) {
        const blurPx = (shadow.blur || 0) * size;
        const dx = (shadow.dx || 0) * size;
        const dy = (shadow.dy || 0) * size;
        const pad = Math.ceil(
          Math.max(blurPx * 1.5, Math.abs(dx), Math.abs(dy)) + 4,
        );
        const shadowCanvas = makeCanvas(
          drawable.width + pad * 2,
          drawable.height + pad * 2,
        );
        const sctx = shadowCanvas.getContext("2d");
        sctx.shadowColor = cssColor({
          ...parseColor(shadow.color),
          a: parseColor(shadow.color).a * shadow.opacity,
        });
        sctx.shadowBlur = blurPx;
        sctx.shadowOffsetX = dx;
        sctx.shadowOffsetY = dy;
        sctx.drawImage(drawable, pad, pad);
        drawable = shadowCanvas;
      }

      ctx.save();
      ctx.globalAlpha = clamp01(sticker.opacity);
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.drawImage(drawable, -drawable.width / 2, -drawable.height / 2);
      ctx.restore();
    }

    async buildStickerContent(sticker, size, options) {
      if (sticker.kind === "text") {
        return this.buildTextContent(sticker, size);
      }
      return this.buildIconContent(sticker, size, options);
    }

    buildTextContent(sticker, size) {
      if (!sticker.text) return null;
      const fontSize = clamp((sticker.scale || 0.16) * size, 1, size * 4);
      const font = `${Math.round(sticker.weight || 700)} ${fontSize}px ${quoteFont(
        sticker.font,
      )}`;
      const measure = this.measureCtx;
      measure.font = font;
      const metrics = measure.measureText(sticker.text);
      const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
      const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
      const textWidth = Math.max(1, metrics.width);
      const textHeight = Math.max(1, ascent + descent);
      const strokePx = sticker.stroke.enabled
        ? clamp((sticker.stroke.width || 0) * size, 0, 512)
        : 0;
      const pad = Math.ceil(strokePx + 4);
      const width = Math.ceil(textWidth + pad * 2);
      const height = Math.ceil(textHeight + pad * 2);
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const x = width / 2;
      const y = pad + ascent;
      if (strokePx > 0) {
        ctx.lineWidth = strokePx * 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = cssColor({
          ...parseColor(sticker.stroke.color),
          a: parseColor(sticker.stroke.color).a * (sticker.stroke.opacity ?? 1),
        });
        ctx.strokeText(sticker.text, x, y);
      }
      ctx.fillStyle = cssColor(sticker.color);
      ctx.fillText(sticker.text, x, y);
      return { canvas };
    }

    async buildIconContent(sticker, size, options) {
      if (!sticker.source) return null;
      const asset = findAsset(options.assets, sticker.source);
      if (!asset) throw missingAsset(sticker.source, options.configName);
      const img = await loadImage(asset.url);
      const maxSide = clamp((sticker.scale || 0.45) * size, 1, size * 8);
      const aspect = (img.naturalWidth || 1) / (img.naturalHeight || 1) || 1;
      const w = Math.max(
        1,
        Math.round(aspect >= 1 ? maxSide : maxSide * aspect),
      );
      const h = Math.max(
        1,
        Math.round(aspect >= 1 ? maxSide / aspect : maxSide),
      );

      const icon = makeCanvas(w, h);
      const ictx = icon.getContext("2d");
      ictx.drawImage(img, 0, 0, w, h);
      if (sticker.recolor && sticker.color) {
        ictx.globalCompositeOperation = "source-in";
        ictx.fillStyle = cssColor(sticker.color);
        ictx.fillRect(0, 0, w, h);
      }

      const strokePx = sticker.stroke.enabled
        ? clamp((sticker.stroke.width || 0) * size, 0, 512)
        : 0;
      if (strokePx <= 0) {
        return { canvas: icon };
      }

      const pad = Math.ceil(strokePx + 2);
      const width = w + pad * 2;
      const height = h + pad * 2;
      const strokeLayer = makeCanvas(width, height);
      const sctx = strokeLayer.getContext("2d");
      const silhouette = makeCanvas(w, h);
      const silCtx = silhouette.getContext("2d");
      silCtx.drawImage(icon, 0, 0);
      silCtx.globalCompositeOperation = "source-in";
      const strokeColor = parseColor(sticker.stroke.color);
      silCtx.fillStyle = `rgb(${Math.round(strokeColor.r)}, ${Math.round(
        strokeColor.g,
      )}, ${Math.round(strokeColor.b)})`;
      silCtx.fillRect(0, 0, w, h);

      const steps = clamp(Math.ceil(strokePx * 2) + 16, 24, 72);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * TAU;
        sctx.drawImage(
          silhouette,
          pad + Math.cos(a) * strokePx,
          pad + Math.sin(a) * strokePx,
        );
      }
      const content = makeCanvas(width, height);
      const cctx = content.getContext("2d");
      cctx.globalAlpha = clamp01(strokeColor.a * (sticker.stroke.opacity ?? 1));
      cctx.drawImage(strokeLayer, 0, 0);
      cctx.globalAlpha = 1;
      cctx.drawImage(icon, pad, pad);
      return { canvas: content };
    }
  }

  window.IconPreviewRenderer = IconPreviewRenderer;
})();
