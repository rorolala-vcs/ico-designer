"use strict";

(function () {
  const EMPTY = 0xffff;
  const MIN_SIZE = 8;
  const MAX_SIZE = 256;
  const MAX_STYLES = 256;
  const PRESET_SIZES = [8, 16, 24, 32, 48, 64, 128, 256];
  const PRESET_COLORS = [
    "#111111",
    "#ffffff",
    "#d92b2b",
    "#ef6c00",
    "#f2c14e",
    "#2e7d32",
    "#1976d2",
    "#1926d2",
    "#7b1fa2",
    "#d81b60",
    "#00897b",
    "#6d4c41",
  ];

  let instance = null;
  let shapesPromise = null;

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function api(path, options = {}) {
    const opts = { ...options };
    if (typeof opts.body === "string") {
      opts.headers = {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      };
    }
    return fetch(path, opts).then(async (res) => {
      const type = res.headers.get("content-type") || "";
      if (!res.ok) {
        let data = null;
        try {
          data = await res.json();
        } catch {
          // ignore
        }
        const err = new Error(
          (data && data.error) || `${res.status} ${res.statusText}`,
        );
        err.status = res.status;
        throw err;
      }
      return type.includes("application/json") ? res.json() : res;
    });
  }

  function toast(message, kind = "ok") {
    if (window.showToast) window.showToast(message, kind);
    else console.log(message);
  }

  function loadShapes() {
    if (!shapesPromise) {
      shapesPromise = api("/api/shapes").catch((err) => {
        shapesPromise = null;
        throw err;
      });
    }
    return shapesPromise;
  }

  class ArtStudio {
    constructor(root, configName, options) {
      this.root = root;
      this.configName = configName;
      this.options = options || {};
      this.shapes = null;
      this.shapeMap = new Map();
      this.pathCache = new Map();
      this.art = null;
      this.artName = null;
      this.cells = null;
      this.styles = [];
      this.width = 32;
      this.height = 32;
      this.arts = [];
      this.brush = {
        shape: "square",
        rotation: 0,
        mirror: false,
        color: "#111111",
      };
      this.view = { cell: 16, x: 0, y: 0 };
      this.hover = null;
      this.painting = null;
      this.panning = null;
      this.spaceDown = false;
      this.rightDown = false;
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      this.revision = 0;
      this.saveTimer = null;
      this.savePromise = null;
      this.savedMtime = 0;
      this.redrawFrame = 0;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cw = 0;
      this.ch = 0;
      this.modalResolve = null;
      this.modalMode = null;
      this.canvas = null;
      this.hoverCanvas = null;
      this.ctx = null;
      this.hoverCtx = null;
      this.el = null;
      this.boundKey = this.onKey.bind(this);
      this.boundKeyUp = this.onKeyUp.bind(this);
      this.boundResize = this.onResize.bind(this);
      this.boundBlur = () => {
        this.spaceDown = false;
        this.el.canvasWrap.classList.remove("space-pan");
      };
      this.closing = false;
    }

    async init() {
      this.buildUi();
      document.body.append(this.root);
      document.addEventListener("keydown", this.boundKey, true);
      document.addEventListener("keyup", this.boundKeyUp, true);
      window.addEventListener("resize", this.boundResize);
      window.addEventListener("blur", this.boundBlur);
      this.observeResize();
      this.bindEvents();
      this.renderPresets();
      this.updateBrushUi();
      this.updateArtUi();
      this.setSaveState("saved");

      try {
        this.shapes = await loadShapes();
        this.shapeMap = new Map();
        for (const group of this.shapes.groups) {
          for (const shape of group.shapes) this.shapeMap.set(shape.id, shape);
        }
        this.renderShapes();
        this.drawBrushPreview();
      } catch (err) {
        toast(`Shapes failed to load: ${err.message}`, "error");
      }

      await this.loadArtList();
      const firstArt = this.arts.find((art) => !art.error);
      if (firstArt) {
        await this.loadArt(firstArt.name, { initial: true });
      } else {
        this.showEmpty(true);
      }
      requestAnimationFrame(() => {
        this.onResize();
        this.fit();
      });
    }

    buildUi() {
      this.root.className = "studio-overlay";
      this.root.innerHTML = `
        <header class="studio-head">
          <div class="studio-brand">
            <span class="studio-brand-mark"></span>
            <span>ART STUDIO</span>
          </div>
          <div class="studio-file">
            <span data-art-name>—</span>
            <span class="studio-dim" data-dim></span>
          </div>
          <div class="studio-head-actions">
            <span class="save-state" data-save title="Saved"></span>
            <button class="mini-btn" data-delete title="Delete current art">Delete</button>
            <button class="icon-btn" data-close title="Close (Esc)">×</button>
          </div>
        </header>

        <aside class="studio-left">
          <div class="studio-section-head">
            <span>ARTS</span>
            <button class="mini-btn" data-new>New</button>
          </div>
          <div class="studio-art-list" data-art-list></div>
          <div class="studio-size">
            <div class="studio-section-head">
              <span>GRID</span>
              <span class="studio-kicker" data-size-hint></span>
            </div>
            <div class="studio-size-row">
              <input class="num" type="number" data-width min="8" max="256" aria-label="Width">
              <span class="studio-times">×</span>
              <input class="num" type="number" data-height min="8" max="256" aria-label="Height">
              <button class="mini-btn" data-resize>Set</button>
            </div>
            <div class="studio-preset-row" data-size-presets></div>
          </div>
        </aside>

        <main class="studio-center">
          <div class="studio-toolbar">
            <div class="studio-zoom">
              <button class="mini-btn" data-zoom-out>−</button>
              <span class="studio-zoom-label" data-zoom-label>—</span>
              <button class="mini-btn" data-zoom-in>+</button>
              <button class="mini-btn" data-fit>Fit</button>
            </div>
            <div class="studio-hint">LMB place · RMB remove · drag · R rotate · F mirror · wheel zoom · middle-drag pan</div>
          </div>
          <div class="studio-canvas-wrap" data-canvas-wrap>
            <canvas data-canvas></canvas>
            <canvas data-hover></canvas>
            <div class="studio-empty hidden" data-empty>
              <div class="studio-empty-card">
                <strong>No art yet</strong>
                <span>Create a grid art file, then draw with the shape palette.</span>
                <button class="btn primary" data-empty-new>New art</button>
              </div>
            </div>
          </div>
        </main>

        <aside class="studio-right">
          <div class="studio-section-head">
            <span>SHAPES</span>
            <span class="studio-kicker" data-shape-count></span>
          </div>
          <div class="studio-shapes" data-shapes></div>
          <div class="studio-brush-panel">
            <div class="studio-section-head"><span>BRUSH</span></div>
            <div class="studio-brush-row">
              <button class="color-chip studio-color" data-brush-color title="Brush color">
                <span data-brush-swatch></span>
              </button>
              <div class="studio-colors" data-colors></div>
            </div>
            <div class="studio-brush-row">
              <button class="mini-btn" data-rotate title="Rotate brush (R)">R · 0°</button>
              <button class="mini-btn" data-mirror title="Mirror brush (F)">F · Off</button>
            </div>
            <div class="studio-brush-preview"><canvas data-brush-preview width="96" height="96"></canvas></div>
            <div class="studio-actions">
              <button class="mini-btn" data-undo>Undo</button>
              <button class="mini-btn" data-redo>Redo</button>
              <button class="mini-btn danger" data-clear>Clear</button>
            </div>
            <div class="studio-hint-line">R / F transform the brush. Ctrl+Z / Ctrl+Shift+Z undo / redo.</div>
          </div>
        </aside>

        <div class="studio-modal hidden" data-modal>
          <div class="studio-modal-card">
            <div class="studio-modal-title" data-modal-title></div>
            <div class="studio-modal-body">
              <p data-modal-text></p>
              <input class="dialog-input hidden" data-modal-input spellcheck="false" autocomplete="off">
              <div class="error-text hidden" data-modal-error></div>
            </div>
            <div class="studio-modal-foot">
              <button class="btn" data-modal-cancel>Cancel</button>
              <button class="btn primary" data-modal-ok>OK</button>
            </div>
          </div>
        </div>
      `;

      const $ = (name) => this.root.querySelector(`[data-${name}]`);
      this.el = {
        $,
        artName: $("art-name"),
        dim: $("dim"),
        save: $("save"),
        delete: $("delete"),
        close: $("close"),
        newArt: $("new"),
        artList: $("art-list"),
        width: $("width"),
        height: $("height"),
        sizeHint: $("size-hint"),
        sizePresets: $("size-presets"),
        resize: $("resize"),
        zoomOut: $("zoom-out"),
        zoomIn: $("zoom-in"),
        zoomLabel: $("zoom-label"),
        fit: $("fit"),
        canvasWrap: $("canvas-wrap"),
        empty: $("empty"),
        emptyNew: $("empty-new"),
        shapes: $("shapes"),
        shapeCount: $("shape-count"),
        brushColor: $("brush-color"),
        brushSwatch: $("brush-swatch"),
        colors: $("colors"),
        rotate: $("rotate"),
        mirror: $("mirror"),
        brushPreview: $("brush-preview"),
        undo: $("undo"),
        redo: $("redo"),
        clear: $("clear"),
        modal: $("modal"),
        modalTitle: $("modal-title"),
        modalText: $("modal-text"),
        modalInput: $("modal-input"),
        modalError: $("modal-error"),
        modalCancel: $("modal-cancel"),
        modalOk: $("modal-ok"),
      };
      this.canvas = this.root.querySelector("[data-canvas]");
      this.hoverCanvas = this.root.querySelector("[data-hover]");
      this.ctx = this.canvas.getContext("2d");
      this.hoverCtx = this.hoverCanvas.getContext("2d");
    }

    bindEvents() {
      const $ = this.el.$;
      this.el.close.addEventListener("click", () => this.close());
      this.el.newArt.addEventListener("click", () => this.newArt());
      this.el.emptyNew.addEventListener("click", () => this.newArt());
      this.el.delete.addEventListener("click", () => this.deleteArt());
      this.el.resize.addEventListener("click", () => this.resizeArt());
      for (const input of [this.el.width, this.el.height]) {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.resizeArt();
          }
        });
      }
      this.el.zoomIn.addEventListener("click", () => this.zoomAt(1.3));
      this.el.zoomOut.addEventListener("click", () => this.zoomAt(1 / 1.3));
      this.el.fit.addEventListener("click", () => this.fit());
      this.el.rotate.addEventListener("click", () => this.rotateBrush());
      this.el.mirror.addEventListener("click", () => this.mirrorBrush());
      this.el.undo.addEventListener("click", () => this.undo());
      this.el.redo.addEventListener("click", () => this.redo());
      this.el.clear.addEventListener("click", () => this.clearArt());
      this.el.brushColor.addEventListener("click", () => this.pickBrushColor());
      this.el.modalCancel.addEventListener("click", () =>
        this.closeModal(false),
      );
      this.el.modalOk.addEventListener("click", () => this.submitModal());
      this.el.modalInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submitModal();
        }
      });

      const wrap = this.el.canvasWrap;
      wrap.addEventListener("contextmenu", (event) => event.preventDefault());
      wrap.addEventListener("pointerdown", (event) =>
        this.onPointerDown(event),
      );
      wrap.addEventListener("pointermove", (event) =>
        this.onPointerMove(event),
      );
      wrap.addEventListener("pointerup", (event) => this.onPointerUp(event));
      wrap.addEventListener("pointercancel", (event) =>
        this.onPointerUp(event),
      );
      wrap.addEventListener("pointerleave", () => {
        if (!this.painting && !this.panning) {
          this.hover = null;
          this.drawHover();
        }
      });
      wrap.addEventListener("wheel", (event) => this.onWheel(event), {
        passive: false,
      });
    }

    observeResize() {
      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.el.canvasWrap);
      }
    }

    onResize() {
      const wrap = this.el.canvasWrap;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      if (width === this.cw && height === this.ch) return;
      this.cw = width;
      this.ch = height;
      for (const canvas of [this.canvas, this.hoverCanvas]) {
        canvas.width = Math.max(1, Math.round(width * this.dpr));
        canvas.height = Math.max(1, Math.round(height * this.dpr));
      }
      this.scheduleRedraw();
      if (this.art && !this.hasFitted) this.fit();
    }

    // ---------- art list ----------

    async loadArtList() {
      try {
        const data = await api(
          `/api/arts?config=${encodeURIComponent(this.configName)}`,
        );
        this.arts = data.arts || [];
      } catch (err) {
        this.arts = [];
        toast(`Art list failed: ${err.message}`, "error");
      }
      this.renderArtList();
    }

    renderArtList() {
      const list = this.el.artList;
      list.innerHTML = "";
      if (!this.arts.length) {
        const empty = document.createElement("div");
        empty.className = "empty-hint";
        empty.textContent = "No art yet.";
        list.append(empty);
        return;
      }
      for (const art of this.arts) {
        const item = document.createElement("button");
        item.className = "studio-art-item";
        if (art.name === this.artName) item.classList.add("selected");
        if (art.error) item.classList.add("error");
        item.title = art.error ? `${art.name}\n${art.error}` : art.name;
        const thumb = document.createElement("span");
        thumb.className = "studio-art-thumb";
        if (art.thumb) {
          const img = document.createElement("img");
          img.src = art.thumb;
          img.alt = "";
          img.draggable = false;
          thumb.append(img);
        }
        const name = document.createElement("span");
        name.className = "studio-art-name";
        name.textContent = art.name;
        const size = document.createElement("span");
        size.className = "studio-art-size";
        size.textContent =
          art.width && art.height ? `${art.width}×${art.height}` : "ERR";
        item.append(thumb, name, size);
        item.addEventListener("click", () => this.switchArt(art.name));
        list.append(item);
      }
    }

    async switchArt(name) {
      if (!name || name === this.artName) return;
      if (this.dirty) {
        await this.saveNow();
        if (this.dirty) {
          toast("Save failed — staying on the current art", "error");
          return;
        }
      }
      await this.loadArt(name);
    }

    async loadArt(name, options = {}) {
      if (this.dirty && this.artName) {
        await this.flush();
        if (this.dirty) {
          toast("Save failed — cannot switch art", "error");
          return;
        }
      }
      try {
        const data = await api(
          `/api/art?config=${encodeURIComponent(this.configName)}&name=${encodeURIComponent(name)}`,
        );
        this.artName = data.name;
        this.art = data.art;
        this.width = data.art.width;
        this.height = data.art.height;
        this.styles = data.art.styles.map((style) => ({ ...style }));
        this.cells = this.parseCells(data.art);
        this.savedMtime = data.mtime;
        this.dirty = false;
        this.undoStack = [];
        this.redoStack = [];
        this.hover = null;
        this.el.width.value = String(this.width);
        this.el.height.value = String(this.height);
        this.showEmpty(false);
        this.updateArtUi();
        this.setSaveState("saved");
        this.renderArtList();
        this.fit();
        this.drawHover();
        if (this.options.onArtChanged) this.options.onArtChanged();
        void options;
      } catch (err) {
        if (!this.art) this.showEmpty(true);
        toast(`Cannot load art: ${err.message}`, "error");
      }
    }

    parseCells(art) {
      const cells = new Uint16Array(art.width * art.height);
      cells.fill(EMPTY);
      for (let y = 0; y < art.height; y++) {
        const row = art.rows[y] || "";
        for (let x = 0; x < art.width; x++) {
          const pair = row.slice(x * 2, x * 2 + 2);
          if (!/^[0-9a-f]{2}$/i.test(pair)) continue;
          const index = parseInt(pair, 16);
          if (
            Number.isFinite(index) &&
            index >= 0 &&
            index < this.styles.length
          ) {
            cells[y * art.width + x] = index;
          }
        }
      }
      return cells;
    }

    serializeCells() {
      const rows = [];
      for (let y = 0; y < this.height; y++) {
        const parts = [];
        for (let x = 0; x < this.width; x++) {
          const index = this.cells[y * this.width + x];
          parts.push(
            index === EMPTY ? ".." : index.toString(16).padStart(2, "0"),
          );
        }
        let row = parts.join("");
        while (row.endsWith("..")) row = row.slice(0, -2);
        rows.push(row);
      }
      return rows;
    }

    markDirty() {
      this.dirty = true;
      this.revision += 1;
      this.setSaveState("dirty");
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.saveNow();
      }, 550);
    }

    setSaveState(kind) {
      const el = this.el.save;
      el.classList.remove("dirty", "saving", "saved");
      if (kind === "saving") {
        el.classList.add("saving");
        el.title = "Saving…";
      } else if (kind === "dirty") {
        el.classList.add("dirty");
        el.title = "Unsaved changes";
      } else {
        el.classList.add("saved");
        el.title = "Saved";
      }
    }

    async saveNow() {
      if (this.savePromise) return this.savePromise;
      if (!this.artName || !this.dirty) return;
      this.savePromise = this.doSave().finally(() => {
        this.savePromise = null;
      });
      return this.savePromise;
    }

    async doSave() {
      const name = this.artName;
      const revision = this.revision;
      this.setSaveState("saving");
      try {
        const saved = await api(
          `/api/art?config=${encodeURIComponent(this.configName)}&name=${encodeURIComponent(name)}`,
          {
            method: "PUT",
            body: JSON.stringify({
              art: {
                width: this.width,
                height: this.height,
                styles: this.styles,
                rows: this.serializeCells(),
              },
            }),
          },
        );
        this.savedMtime = saved.mtime;
        if (this.revision === revision) this.dirty = false;
        const entry = this.arts.find((a) => a.name === name);
        if (entry) {
          entry.width = saved.art.width;
          entry.height = saved.art.height;
          entry.mtime = saved.mtime;
          entry.thumb = `/api/art-svg?config=${encodeURIComponent(
            this.configName,
          )}&name=${encodeURIComponent(name)}&v=${saved.mtime}`;
          this.renderArtList();
        }
        this.setSaveState(this.dirty ? "dirty" : "saved");
        if (this.options.onArtSaved) this.options.onArtSaved(name);
      } catch (err) {
        toast(`Art save failed: ${err.message}`, "error");
        this.setSaveState("dirty");
      } finally {
        if (this.dirty && this.artName === name) {
          clearTimeout(this.saveTimer);
          this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
          }, 900);
        }
      }
    }

    async flush() {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.dirty) await this.saveNow();
      return !this.dirty;
    }

    showEmpty(show) {
      this.el.empty.classList.toggle("hidden", !show);
    }

    updateArtUi() {
      this.el.artName.textContent = this.artName || "No art";
      this.el.dim.textContent =
        this.artName && this.art
          ? `${this.width} × ${this.height}`
          : "PLACE A GRID, THEN DRAW";
      this.el.sizeHint.textContent = `${this.width}×${this.height}`;
      this.el.width.value = String(this.width);
      this.el.height.value = String(this.height);
      this.el.delete.disabled = !this.artName;
      this.el.undo.disabled = this.undoStack.length === 0;
      this.el.redo.disabled = this.redoStack.length === 0;
      this.el.clear.disabled = !this.artName;
      this.el.shapeCount.textContent = this.shapes
        ? `${this.shapes.groups.reduce((n, g) => n + g.shapes.length, 0)} SHAPES`
        : "";
    }

    // ---------- creation / deletion / resize ----------

    async newArt() {
      const existing = new Set(this.arts.map((a) => a.name));
      let suggestion = "art-1";
      for (let i = 2; existing.has(suggestion); i++) suggestion = `art-${i}`;
      const name = await this.ask(
        "New art",
        "Name the art TOML file.",
        suggestion,
        "Create",
      );
      if (!name) return;
      const width = clamp(
        Number(this.el.width.value) || 32,
        MIN_SIZE,
        MAX_SIZE,
      );
      const height = clamp(
        Number(this.el.height.value) || 32,
        MIN_SIZE,
        MAX_SIZE,
      );
      try {
        const created = await api("/api/art", {
          method: "POST",
          body: JSON.stringify({
            config: this.configName,
            name,
            width,
            height,
          }),
        });
        await this.loadArtList();
        await this.loadArt(created.name);
        toast(`Created art/${created.name}.toml`);
      } catch (err) {
        toast(err.message, "error");
      }
    }

    async deleteArt() {
      if (!this.artName) return;
      const ok = await this.confirm(
        "Delete art",
        `Delete art/${this.artName}.toml? Icons referencing it will lose this asset.`,
        "Delete",
      );
      if (!ok) return;
      try {
        await api(
          `/api/art?config=${encodeURIComponent(this.configName)}&name=${encodeURIComponent(
            this.artName,
          )}`,
          { method: "DELETE" },
        );
        const deleted = this.artName;
        this.artName = null;
        this.art = null;
        this.cells = null;
        this.dirty = false;
        this.undoStack = [];
        this.redoStack = [];
        await this.loadArtList();
        if (this.arts.length) await this.loadArt(this.arts[0].name);
        else this.showEmpty(true);
        this.updateArtUi();
        this.setSaveState("saved");
        toast(`Deleted art/${deleted}.toml`);
        if (this.options.onArtSaved) this.options.onArtSaved(deleted);
      } catch (err) {
        toast(err.message, "error");
      }
    }

    async resizeArt() {
      if (!this.art) return;
      const width = clamp(
        Number(this.el.width.value) || this.width,
        MIN_SIZE,
        MAX_SIZE,
      );
      const height = clamp(
        Number(this.el.height.value) || this.height,
        MIN_SIZE,
        MAX_SIZE,
      );
      if (width === this.width && height === this.height) return;
      const cropped = this.hasCellsOutside(width, height);
      if (cropped) {
        const ok = await this.confirm(
          "Crop art",
          `Shrinking to ${width}×${height} will remove cells outside the new grid. Continue?`,
          "Crop",
        );
        if (!ok) {
          this.el.width.value = String(this.width);
          this.el.height.value = String(this.height);
          return;
        }
      }
      this.pushUndo();
      const next = new Uint16Array(width * height);
      next.fill(EMPTY);
      const copyW = Math.min(width, this.width);
      const copyH = Math.min(height, this.height);
      for (let y = 0; y < copyH; y++) {
        for (let x = 0; x < copyW; x++) {
          next[y * width + x] = this.cells[y * this.width + x];
        }
      }
      this.width = width;
      this.height = height;
      this.cells = next;
      this.art.width = width;
      this.art.height = height;
      this.updateArtUi();
      this.fit();
      this.markDirty();
      this.drawHover();
    }

    hasCellsOutside(width, height) {
      if (width >= this.width && height >= this.height) return false;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          if (x < width && y < height) continue;
          if (this.cells[y * this.width + x] !== EMPTY) return true;
        }
      }
      return false;
    }

    // ---------- undo / redo ----------

    snapshot() {
      return {
        width: this.width,
        height: this.height,
        cells: this.cells.slice(),
        styles: this.styles.map((style) => ({ ...style })),
      };
    }

    pushUndo() {
      if (!this.cells) return;
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 40) this.undoStack.shift();
      this.redoStack = [];
      this.updateArtUi();
    }

    restoreSnapshot(snap) {
      this.width = snap.width;
      this.height = snap.height;
      this.cells = snap.cells.slice();
      this.styles = snap.styles.map((style) => ({ ...style }));
      this.art.width = this.width;
      this.art.height = this.height;
      this.art.styles = this.styles;
      this.updateArtUi();
      this.fit();
      this.markDirty();
      this.drawHover();
    }

    undo() {
      if (!this.undoStack.length || !this.art) return;
      this.redoStack.push(this.snapshot());
      this.restoreSnapshot(this.undoStack.pop());
      this.updateArtUi();
    }

    redo() {
      if (!this.redoStack.length || !this.art) return;
      this.undoStack.push(this.snapshot());
      this.restoreSnapshot(this.redoStack.pop());
      this.updateArtUi();
    }

    async clearArt() {
      if (!this.art || !this.cells) return;
      const ok = await this.confirm(
        "Clear art",
        "Clear all cells? This can be undone.",
        "Clear",
      );
      if (!ok) return;
      this.pushUndo();
      this.cells.fill(EMPTY);
      this.markDirty();
      this.scheduleRedraw();
      this.drawHover();
    }

    // ---------- brush ----------

    findOrAddStyle() {
      const style = {
        shape: this.brush.shape,
        rotation: this.brush.rotation,
        mirror: this.brush.mirror,
        color: this.brush.color,
      };
      let index = this.styles.findIndex(
        (s) =>
          s.shape === style.shape &&
          s.rotation === style.rotation &&
          s.mirror === style.mirror &&
          s.color === style.color,
      );
      if (index >= 0) return index;
      if (this.styles.length >= MAX_STYLES) {
        this.pruneStyles();
        index = this.styles.findIndex(
          (s) =>
            s.shape === style.shape &&
            s.rotation === style.rotation &&
            s.mirror === style.mirror &&
            s.color === style.color,
        );
        if (index >= 0) return index;
      }
      if (this.styles.length >= MAX_STYLES) {
        toast("Maximum 256 brush variants reached", "error");
        return null;
      }
      this.styles.push(style);
      return this.styles.length - 1;
    }

    pruneStyles() {
      const used = new Set();
      for (let i = 0; i < this.cells.length; i++) {
        if (this.cells[i] !== EMPTY) used.add(this.cells[i]);
      }
      const map = new Map();
      const next = [];
      for (let i = 0; i < this.styles.length; i++) {
        if (!used.has(i)) continue;
        map.set(i, next.length);
        next.push(this.styles[i]);
      }
      for (let i = 0; i < this.cells.length; i++) {
        if (this.cells[i] !== EMPTY) this.cells[i] = map.get(this.cells[i]);
      }
      this.styles = next;
      this.art.styles = next;
    }

    rotateBrush() {
      this.brush.rotation = (this.brush.rotation + 90) % 360;
      this.updateBrushUi();
      this.drawHover();
    }

    mirrorBrush() {
      this.brush.mirror = !this.brush.mirror;
      this.updateBrushUi();
      this.drawHover();
    }

    pickBrushColor() {
      if (!window.ColorPicker) return;
      window.ColorPicker.open({
        anchor: this.el.brushColor,
        color: this.brush.color,
        onChange: (hex) => {
          this.brush.color = hex;
          this.updateBrushUi();
          this.drawHover();
        },
      });
    }

    updateBrushUi() {
      this.el.rotate.textContent = `R · ${this.brush.rotation}°`;
      this.el.mirror.textContent = `F · ${this.brush.mirror ? "On" : "Off"}`;
      this.el.brushSwatch.style.background = this.brush.color;
      this.root
        .querySelectorAll(".studio-shape-btn svg path")
        .forEach((path) => {
          path.setAttribute("fill", this.brush.color);
        });
      this.drawBrushPreview();
    }

    drawBrushPreview() {
      const canvas = this.el.brushPreview;
      const ctx = canvas.getContext("2d");
      const size = canvas.width;
      ctx.clearRect(0, 0, size, size);
      const shape = this.shapeMap.get(this.brush.shape);
      if (!shape) return;
      const path = this.getPath(shape);
      const pad = 12;
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate((this.brush.rotation * Math.PI) / 180);
      ctx.scale(
        (this.brush.mirror ? -1 : 1) * (size - pad * 2),
        size - pad * 2,
      );
      ctx.translate(-0.5, -0.5);
      ctx.fillStyle = this.brush.color;
      ctx.fill(path, shape.fillRule || "nonzero");
      ctx.restore();
    }

    getPath(shape) {
      let path = this.pathCache.get(shape.id);
      if (!path) {
        path = new Path2D(shape.d);
        this.pathCache.set(shape.id, path);
      }
      return path;
    }

    renderShapes() {
      if (!this.shapes) return;
      const host = this.el.shapes;
      host.innerHTML = "";
      let count = 0;
      for (const group of this.shapes.groups) {
        const head = document.createElement("div");
        head.className = "studio-shape-group";
        head.textContent = group.name;
        host.append(head);
        const grid = document.createElement("div");
        grid.className = "studio-shape-grid";
        for (const shape of group.shapes) {
          count++;
          const btn = document.createElement("button");
          btn.className = "studio-shape-btn";
          btn.dataset.shape = shape.id;
          btn.title = `${shape.label} · ${shape.id}`;
          if (shape.id === this.brush.shape) btn.classList.add("selected");
          btn.innerHTML = `<svg viewBox="0 0 1 1"><path d="${shape.d}" fill-rule="${
            shape.fillRule || "nonzero"
          }" fill="${this.brush.color}" stroke="rgba(0,0,0,.55)" stroke-width="0.025"/></svg>`;
          btn.addEventListener("click", () => {
            this.brush.shape = shape.id;
            this.root.querySelectorAll(".studio-shape-btn").forEach((el) => {
              el.classList.toggle("selected", el === btn);
            });
            this.updateBrushUi();
            this.drawHover();
          });
          grid.append(btn);
        }
        host.append(grid);
      }
      this.el.shapeCount.textContent = `${count} SHAPES`;
      this.drawBrushPreview();
    }

    renderPresets() {
      const host = this.el.sizePresets;
      host.innerHTML = "";
      for (const size of PRESET_SIZES) {
        const btn = document.createElement("button");
        btn.className = "mini-btn";
        btn.textContent = String(size);
        btn.title = `${size} × ${size}`;
        btn.addEventListener("click", () => {
          this.el.width.value = String(size);
          this.el.height.value = String(size);
          this.resizeArt();
        });
        host.append(btn);
      }

      const colors = this.el.colors;
      colors.innerHTML = "";
      for (const color of PRESET_COLORS) {
        const btn = document.createElement("button");
        btn.className = "studio-color-chip";
        btn.style.background = color;
        btn.title = color;
        btn.addEventListener("click", () => {
          this.brush.color = color;
          this.updateBrushUi();
          this.drawHover();
        });
        colors.append(btn);
      }
    }

    // ---------- canvas geometry ----------

    fit() {
      if (!this.art || !this.cw || !this.ch) return;
      const pad = 28;
      const cell = Math.max(
        1,
        Math.min(
          (this.cw - pad * 2) / this.width,
          (this.ch - pad * 2) / this.height,
        ),
      );
      this.view.cell = cell;
      this.view.x = (this.cw - this.width * cell) / 2;
      this.view.y = (this.ch - this.height * cell) / 2;
      this.hasFitted = true;
      this.updateZoomLabel();
      this.scheduleRedraw();
      this.drawHover();
    }

    updateZoomLabel() {
      this.el.zoomLabel.textContent = `${Math.round(this.view.cell * 10) / 10}px`;
    }

    zoomAt(factor, mx, my) {
      if (!this.art) return;
      const cell = clamp(this.view.cell * factor, 0.75, 160);
      if (cell === this.view.cell) return;
      const x = mx === undefined ? this.cw / 2 : mx;
      const y = my === undefined ? this.ch / 2 : my;
      const worldX = (x - this.view.x) / this.view.cell;
      const worldY = (y - this.view.y) / this.view.cell;
      this.view.cell = cell;
      this.view.x = x - worldX * cell;
      this.view.y = y - worldY * cell;
      this.updateZoomLabel();
      this.scheduleRedraw();
      this.drawHover();
    }

    cellAt(event) {
      if (!this.art) return null;
      const rect = this.el.canvasWrap.getBoundingClientRect();
      const x = Math.floor(
        (event.clientX - rect.left - this.view.x) / this.view.cell,
      );
      const y = Math.floor(
        (event.clientY - rect.top - this.view.y) / this.view.cell,
      );
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
      return { x, y };
    }

    scheduleRedraw() {
      if (this.redrawFrame) return;
      this.redrawFrame = requestAnimationFrame(() => {
        this.redrawFrame = 0;
        this.redraw();
      });
    }

    redraw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      if (!this.art || !this.cells) return;
      const cell = this.view.cell;
      const x0 = this.view.x;
      const y0 = this.view.y;
      const w = this.width * cell;
      const h = this.height * cell;

      for (let y = 0; y < this.height; y++) {
        let x = 0;
        while (x < this.width) {
          const index = this.cells[y * this.width + x];
          if (index === EMPTY || !this.styles[index]) {
            x++;
            continue;
          }
          const style = this.styles[index];
          const shape = this.shapeMap.get(style.shape);
          if (shape && shape.id === "square") {
            let run = 1;
            while (
              x + run < this.width &&
              this.cells[y * this.width + x + run] === index
            ) {
              run++;
            }
            ctx.fillStyle = style.color;
            ctx.fillRect(x0 + x * cell, y0 + y * cell, run * cell, cell);
            x += run;
            continue;
          }
          if (shape) this.paintShape(ctx, style, shape, x, y, cell, x0, y0, 1);
          x++;
        }
      }

      if (cell >= 4) {
        ctx.save();
        ctx.strokeStyle = "rgba(16,16,16,.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= this.width; x++) {
          const px = Math.round(x0 + x * cell) + 0.5;
          ctx.moveTo(px, y0);
          ctx.lineTo(px, y0 + h);
        }
        for (let y = 0; y <= this.height; y++) {
          const py = Math.round(y0 + y * cell) + 0.5;
          ctx.moveTo(x0, py);
          ctx.lineTo(x0 + w, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = "#101010";
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 - 1, y0 - 1, w + 2, h + 2);
    }

    paintShape(ctx, style, shape, x, y, cell, ox, oy, alpha) {
      const path = this.getPath(shape);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell);
      ctx.rotate((style.rotation * Math.PI) / 180);
      ctx.scale((style.mirror ? -1 : 1) * cell, cell);
      ctx.translate(-0.5, -0.5);
      ctx.fillStyle = style.color;
      ctx.fill(path, shape.fillRule || "nonzero");
      ctx.restore();
    }

    drawHover() {
      if (!this.hoverCtx) return;
      const ctx = this.hoverCtx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      if (!this.art || !this.hover || !this.cells) return;
      const { x, y } = this.hover;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
      const cell = this.view.cell;
      const ox = this.view.x;
      const oy = this.view.y;
      if (this.rightDown) {
        ctx.fillStyle = "rgba(16,16,16,.12)";
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        ctx.strokeStyle = "#101010";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(
          ox + x * cell + 0.5,
          oy + y * cell + 0.5,
          cell - 1,
          cell - 1,
        );
        ctx.setLineDash([]);
        return;
      }
      const shape = this.shapeMap.get(this.brush.shape);
      if (shape) {
        const style = {
          shape: shape.id,
          rotation: this.brush.rotation,
          mirror: this.brush.mirror,
          color: this.brush.color,
        };
        this.paintShapeHover(ctx, style, shape, x, y, cell, ox, oy);
      }
      ctx.strokeStyle = "#101010";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + x * cell + 0.5,
        oy + y * cell + 0.5,
        cell - 1,
        cell - 1,
      );
      if (cell >= 12) {
        ctx.strokeStyle = "rgba(255,255,255,.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          ox + x * cell + 2.5,
          oy + y * cell + 2.5,
          cell - 5,
          cell - 5,
        );
      }
    }

    paintShapeHover(ctx, style, shape, x, y, cell, ox, oy) {
      const path = this.getPath(shape);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell);
      ctx.rotate((style.rotation * Math.PI) / 180);
      ctx.scale((style.mirror ? -1 : 1) * cell, cell);
      ctx.translate(-0.5, -0.5);
      ctx.fillStyle = style.color;
      ctx.fill(path, shape.fillRule || "nonzero");
      ctx.restore();
    }

    // ---------- pointer ----------

    onPointerDown(event) {
      if (!this.art) return;
      if (event.button === 1 || (event.button === 0 && this.spaceDown)) {
        this.startPan(event);
        return;
      }
      const cell = this.cellAt(event);
      if (!cell) return;
      if (event.button === 0) {
        this.startStroke(event, "place", cell);
      } else if (event.button === 2) {
        this.rightDown = true;
        this.startStroke(event, "erase", cell);
      }
    }

    startPan(event) {
      this.panning = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: this.view.x,
        y: this.view.y,
      };
      this.el.canvasWrap.classList.add("panning");
      this.el.canvasWrap.setPointerCapture(event.pointerId);
      this.hover = null;
      this.drawHover();
      event.preventDefault();
    }

    startStroke(event, mode, cell) {
      this.pushUndo();
      const styleIndex = mode === "place" ? this.findOrAddStyle() : null;
      if (mode === "place" && styleIndex === null) return;
      this.painting = {
        id: event.pointerId,
        mode,
        styleIndex,
        last: cell,
      };
      this.el.canvasWrap.setPointerCapture(event.pointerId);
      this.applyCell(cell.x, cell.y, mode, styleIndex);
      this.hover = cell;
      this.drawHover();
      event.preventDefault();
    }

    onPointerMove(event) {
      if (!this.art) return;
      if (this.panning && event.pointerId === this.panning.id) {
        this.view.x = this.panning.x + (event.clientX - this.panning.startX);
        this.view.y = this.panning.y + (event.clientY - this.panning.startY);
        this.scheduleRedraw();
        return;
      }
      const cell = this.cellAt(event);
      if (this.painting && event.pointerId === this.painting.id) {
        if (cell) {
          this.paintLine(
            this.painting.last.x,
            this.painting.last.y,
            cell.x,
            cell.y,
            this.painting.mode,
            this.painting.styleIndex,
          );
          this.painting.last = cell;
          this.hover = cell;
          this.drawHover();
        }
        return;
      }
      this.hover = cell;
      this.drawHover();
    }

    onPointerUp(event) {
      if (this.panning && event.pointerId === this.panning.id) {
        this.panning = null;
        this.el.canvasWrap.classList.remove("panning");
        try {
          this.el.canvasWrap.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      if (this.painting && event.pointerId === this.painting.id) {
        this.painting = null;
        try {
          this.el.canvasWrap.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
        this.rightDown = false;
        this.drawHover();
      }
    }

    onWheel(event) {
      if (!this.art) return;
      event.preventDefault();
      const rect = this.el.canvasWrap.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.zoomAt(factor, mx, my);
    }

    paintLine(x0, y0, x1, y1, mode, styleIndex) {
      let x = x0;
      let y = y0;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        this.applyCell(x, y, mode, styleIndex);
        if (x === x1 && y === y1) break;
        const e2 = err * 2;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
    }

    applyCell(x, y, mode, styleIndex) {
      if (!this.cells) return;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
      const index = y * this.width + x;
      const next = mode === "place" ? styleIndex : EMPTY;
      if (this.cells[index] === next) return;
      this.cells[index] = next;
      this.markDirty();
      this.scheduleRedraw();
    }

    // ---------- keyboard ----------

    onKeyUp(event) {
      if (event.key === " " || event.code === "Space") {
        this.spaceDown = false;
        this.el.canvasWrap.classList.remove("space-pan");
      }
    }

    onKey(event) {
      if (document.querySelector(".cp-panel")) return;
      if (this.modalResolve) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeModal(false);
        }
        return;
      }
      const target = event.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? this.redo() : this.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.redo();
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key === " " || event.code === "Space") {
        this.spaceDown = true;
        this.el.canvasWrap.classList.add("space-pan");
        event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        this.rotateBrush();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        this.mirrorBrush();
      }
    }

    // ---------- modal ----------

    ask(title, label, value, confirmLabel) {
      return new Promise((resolve) => {
        this.modalResolve = resolve;
        this.modalMode = "input";
        this.el.modalTitle.textContent = title;
        this.el.modalText.textContent = label;
        this.el.modalInput.classList.remove("hidden");
        this.el.modalInput.value = value || "";
        this.el.modalError.classList.add("hidden");
        this.el.modalError.textContent = "";
        this.el.modalOk.textContent = confirmLabel || "OK";
        this.el.modal.classList.remove("hidden");
        setTimeout(() => {
          this.el.modalInput.focus();
          this.el.modalInput.select();
        }, 0);
      });
    }

    confirm(title, message, confirmLabel) {
      return new Promise((resolve) => {
        this.modalResolve = resolve;
        this.modalMode = "confirm";
        this.el.modalTitle.textContent = title;
        this.el.modalText.textContent = message;
        this.el.modalInput.classList.add("hidden");
        this.el.modalError.classList.add("hidden");
        this.el.modalOk.textContent = confirmLabel || "OK";
        this.el.modal.classList.remove("hidden");
        setTimeout(() => this.el.modalOk.focus(), 0);
      });
    }

    askError(message) {
      this.el.modalError.textContent = message;
      this.el.modalError.classList.remove("hidden");
    }

    submitModal() {
      if (!this.modalResolve) return;
      if (this.modalMode === "confirm") {
        this.closeModal(true);
        return;
      }
      const value = this.el.modalInput.value.trim();
      if (!value) {
        this.askError("A name is required.");
        return;
      }
      this.closeModal(value);
    }

    closeModal(result) {
      if (!this.modalResolve) return;
      const resolve = this.modalResolve;
      this.modalResolve = null;
      this.el.modal.classList.add("hidden");
      resolve(result === false ? null : result);
    }

    // ---------- close ----------

    async close() {
      if (this.closing) return;
      this.closing = true;
      if (window.ColorPicker) window.ColorPicker.close();
      const ok = await this.flush();
      if (!ok) {
        this.closing = false;
        toast("Art save failed — close aborted", "error");
        return;
      }
      document.removeEventListener("keydown", this.boundKey, true);
      document.removeEventListener("keyup", this.boundKeyUp, true);
      window.removeEventListener("resize", this.boundResize);
      window.removeEventListener("blur", this.boundBlur);
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.redrawFrame) cancelAnimationFrame(this.redrawFrame);
      this.root.remove();
      instance = null;
      if (this.options.onClose) this.options.onClose();
    }
  }

  function open(options) {
    if (instance) {
      instance.close();
    }
    const root = document.createElement("div");
    const studio = new ArtStudio(root, options.configName, options);
    instance = studio;
    studio.init().catch((err) => {
      toast(err.message, "error");
    });
  }

  window.ArtStudio = { open };
})();
