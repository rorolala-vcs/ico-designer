"use strict";

/* ---------- tiny helpers ---------- */

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

const ID_KEYS = ["RedId", "BlueId", "GreenId"];
const ID_LETTER = { RedId: "R", BlueId: "B", GreenId: "G" };
const ID_ROLE = { RedId: "ACCENT", BlueId: "SECONDARY", GreenId: "PRIMARY" };
const ID_DEFAULT = {
  RedId: "#d92b2b",
  BlueId: "#1926d2",
  GreenId: "#1976d2",
};
const FILL_TYPES = ["solid", "linear", "radial", "conic", "pattern"];

const state = {
  meta: { categories: [], fonts: [], defaultFont: "sans-serif" },
  configs: [],
  name: null,
  config: null,
  mtime: 0,
  assets: [],
  selectedId: "GreenId",
  selectedSticker: null,
  dirty: false,
  saving: false,
  revision: 0,
  savePromise: null,
  previewFrame: 0,
  previewToken: 0,
  saveTimer: null,
  polling: false,
  switching: false,
  bg: 0,
  stopsKey: "",
  stickerListKey: "",
  patternGridKey: "",
  stickerAssetsKey: "",
};

const pairs = {};
const previewRenderer = new window.IconPreviewRenderer(
  document.getElementById("preview-canvas"),
  { size: 640 },
);

/* ---------- generic ui helpers ---------- */

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function clamp01(n) {
  return clamp(n, 0, 1);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function setValue(el, value) {
  if (!el) return;
  if (document.activeElement === el) return;
  const v = value === undefined || value === null ? "" : String(value);
  if (el.value !== v) el.value = v;
}

function normalizeHex(value, fallback = "#000000") {
  if (typeof value !== "string") return fallback;
  let s = value.trim().toLowerCase();
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s))
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (/^[0-9a-f]{4}$/.test(s))
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `#${s}`;
  return fallback;
}

function parseRgba(hex) {
  const h = normalizeHex(hex, "#000000").slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

function rgbaToHex(color) {
  const c = (n) =>
    Math.round(clamp(n, 0, 255))
      .toString(16)
      .padStart(2, "0");
  const rgb = `${c(color.r)}${c(color.g)}${c(color.b)}`;
  if (color.a >= 0.999) return `#${rgb}`;
  return `#${rgb}${c(color.a * 255)}`;
}

function mixHex(a, b, t) {
  const ca = parseRgba(a);
  const cb = parseRgba(b);
  return rgbaToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
    a: ca.a + (cb.a - ca.a) * t,
  });
}

function shadeHex(hex, amount) {
  const c = parseRgba(hex);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return rgbaToHex({
    r: c.r + (target - c.r) * t,
    g: c.g + (target - c.g) * t,
    b: c.b + (target - c.b) * t,
    a: c.a,
  });
}

function fillCss(fill) {
  if (!fill) return "#777777";
  if (fill.type === "solid") return fill.color || "#777777";
  if (fill.type === "pattern") {
    const asset = findAsset(fill.source);
    return asset
      ? "#ffffff"
      : "repeating-linear-gradient(45deg,#fff 0 6px,#ddd 6px 12px)";
  }
  const stops = (fill.stops || [])
    .map((s) => `${s.color} ${Math.round(clamp01(s.offset) * 100)}%`)
    .join(", ");
  if (fill.type === "linear") {
    return `linear-gradient(${(fill.angle || 0) + 90}deg, ${stops})`;
  }
  if (fill.type === "radial") {
    return `radial-gradient(circle ${Math.round((fill.radius || 0.72) * 100)}% at ${(
      (fill.cx ?? 0.5) * 100
    ).toFixed(1)}% ${((fill.cy ?? 0.5) * 100).toFixed(1)}%, ${stops})`;
  }
  if (fill.type === "conic") {
    return `conic-gradient(from ${fill.angle || 0}deg at ${(
      (fill.cx ?? 0.5) * 100
    ).toFixed(1)}% ${((fill.cy ?? 0.5) * 100).toFixed(1)}%, ${stops})`;
  }
  return "#777777";
}

function applyFillBackground(el, fill) {
  if (!el) return;
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.backgroundColor = "";
  if (!fill) return;
  if (fill.type === "pattern") {
    el.style.backgroundColor = "#ffffff";
    const asset = findAsset(fill.source);
    if (asset) {
      el.style.backgroundImage = `url("${asset.url}")`;
      el.style.backgroundSize = `${Math.max(4, (fill.scale || 0.25) * 100)}%`;
      el.style.backgroundPosition = `${(fill.offset_x || 0) * 100}% ${(fill.offset_y || 0) * 100}%`;
      el.style.backgroundRepeat = "repeat";
    }
    return;
  }
  if (fill.type === "solid") {
    el.style.backgroundColor = fill.color || "#777777";
    return;
  }
  el.style.backgroundImage = fillCss(fill);
}

function currentFill() {
  return state.config ? state.config.ids[state.selectedId] : null;
}

function currentSticker() {
  if (!state.config || state.selectedSticker === null) return null;
  return state.config.stickers[state.selectedSticker] || null;
}

function findAsset(name) {
  if (!name) return null;
  const needle = String(name).toLowerCase();
  return (
    state.assets.find((a) => a.name.toLowerCase() === needle) ||
    state.assets.find((a) => a.file.toLowerCase() === needle) ||
    null
  );
}

function firstAssetName() {
  return state.assets.length ? state.assets[0].file : "";
}

function assetsSignature() {
  return state.assets.map((a) => a.url).join("|");
}

/* ---------- api ---------- */

async function api(url, options = {}) {
  const opts = { ...options };
  if (typeof opts.body === "string") {
    opts.headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };
  }
  const res = await fetch(url, opts);
  const type = res.headers.get("content-type") || "";
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      // not json
    }
    const err = new Error(
      (data && data.error) || `${res.status} ${res.statusText}`,
    );
    err.status = res.status;
    if (data) {
      err.data = data;
      err.toml = data.toml;
    }
    throw err;
  }
  if (type.includes("application/json")) return res.json();
  return res;
}

/* ---------- toast / overlays ---------- */

let toastTimer = null;

function showToast(message, kind = "ok") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = `toast${kind === "error" ? " error" : ""}`;
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === "error" ? 4200 : 2600);
}

function makeOverlay(options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const dialog = document.createElement("div");
  dialog.className = `dialog${options.wide ? " wide" : ""}`;
  const head = document.createElement("div");
  head.className = "dialog-head";
  const title = document.createElement("div");
  title.className = "dialog-title";
  title.textContent = options.title || "";
  const closeBtn = document.createElement("button");
  closeBtn.className = "mini-btn";
  closeBtn.textContent = "Esc";
  head.append(title, closeBtn);
  const body = document.createElement("div");
  body.className = "dialog-body";
  const foot = document.createElement("div");
  foot.className = "dialog-foot";
  dialog.append(head, body, foot);
  overlay.append(dialog);
  document.body.append(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  return { overlay, dialog, body, foot, close };
}

function promptDialog({ title, label, value, confirmLabel, onConfirm }) {
  const ui = makeOverlay({ title });
  const text = document.createElement("p");
  text.textContent = label;
  const input = document.createElement("input");
  input.className = "dialog-input";
  input.value = value || "";
  input.spellcheck = false;
  input.autocomplete = "off";
  const error = document.createElement("div");
  error.className = "error-text hidden";
  ui.body.append(text, input, error);
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "btn primary";
  ok.textContent = confirmLabel || "OK";
  ui.foot.append(cancel, ok);

  cancel.addEventListener("click", ui.close);
  let busy = false;
  const submit = async () => {
    if (busy) return;
    busy = true;
    ok.disabled = true;
    try {
      await onConfirm(input.value.trim());
      ui.close();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
      ok.disabled = false;
      busy = false;
    }
  };
  ok.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function confirmDialog({ title, message, confirmLabel, onConfirm }) {
  const ui = makeOverlay({ title });
  const p = document.createElement("p");
  p.textContent = message;
  const error = document.createElement("div");
  error.className = "error-text hidden";
  ui.body.append(p, error);
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  const ok = document.createElement("button");
  ok.className = "btn primary";
  ok.textContent = confirmLabel || "Delete";
  ui.foot.append(cancel, ok);
  cancel.addEventListener("click", ui.close);
  let busy = false;
  ok.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    ok.disabled = true;
    try {
      await onConfirm();
      ui.close();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
      ok.disabled = false;
      busy = false;
    }
  });
}

/* ---------- save state ---------- */

function updateSaveState() {
  const el = $("save-state");
  if (!el) return;
  el.classList.remove("dirty", "saving", "saved");
  if (!state.config) {
    el.title = "No config";
    return;
  }
  if (state.saving) {
    el.classList.add("saving");
    el.title = "Saving…";
  } else if (state.dirty) {
    el.classList.add("dirty");
    el.title = "Unsaved changes";
  } else {
    el.classList.add("saved");
    el.title = "Saved";
  }
}

function markDirty() {
  if (!state.config) return;
  state.dirty = true;
  state.revision += 1;
  updateSaveState();
  syncInspector();
  schedulePreview();
  scheduleSave();
}

function scheduleSave(delay = 700) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    saveNow();
  }, delay);
}

async function saveNow() {
  if (state.savePromise) return state.savePromise;
  if (!state.dirty || !state.config || !state.name) return;
  state.savePromise = doSave().finally(() => {
    state.savePromise = null;
  });
  return state.savePromise;
}

async function doSave() {
  const name = state.name;
  const revision = state.revision;
  const body = JSON.stringify({ config: state.config });
  state.saving = true;
  updateSaveState();
  try {
    const saved = await api(`/api/config/${encodeURIComponent(name)}`, {
      method: "PUT",
      body,
    });
    state.mtime = saved.mtime;
    if (state.revision === revision) {
      state.config = saved.config;
      state.dirty = false;
      syncInspector();
    }
    updateStatusFooter();
    refreshConfigs({ silent: true }).catch(() => {});
  } catch (err) {
    showToast(`Save failed: ${err.message}`, "error");
  } finally {
    state.saving = false;
    updateSaveState();
    if (state.dirty) scheduleSave(900);
  }
}

/* ---------- preview ---------- */

function schedulePreview() {
  if (state.previewFrame) return;
  state.previewFrame = requestAnimationFrame(() => {
    state.previewFrame = 0;
    renderPreview();
  });
}

async function renderPreview() {
  if (!state.config) return;
  const token = ++state.previewToken;
  const config = state.config;
  const assets = state.assets;
  const name = state.name;
  try {
    const drew = await previewRenderer.render(config, {
      assets,
      configName: name,
    });
    if (!drew || token !== state.previewToken || !state.config) return;
    $("preview-canvas").classList.remove("hidden");
    $("stage-message").classList.add("hidden");
    setStatusError("");
    updateStickerMarker();
    updateStatusFooter();
  } catch (err) {
    if (token !== state.previewToken) return;
    setStatusError(err.message);
  }
}

function setStatusError(message) {
  const el = $("status-error");
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
  } else {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

function updateStickerMarker() {
  const marker = $("sticker-marker");
  const img = $("preview-canvas");
  const sticker = currentSticker();
  if (!marker || !img || !sticker || img.classList.contains("hidden")) {
    marker?.classList.add("hidden");
    return;
  }
  const ir = img.getBoundingClientRect();
  const wr = $("canvas-wrap").getBoundingClientRect();
  if (ir.width < 2 || ir.height < 2) {
    marker.classList.add("hidden");
    return;
  }
  const cx =
    ir.left - wr.left + (sticker.x + (sticker.offset_x || 0)) * ir.width;
  const cy =
    ir.top - wr.top + (sticker.y + (sticker.offset_y || 0)) * ir.height;
  marker.style.left = `${cx}px`;
  marker.style.top = `${cy}px`;
  marker.classList.remove("hidden");
}

function updateStatusFooter() {
  if (!state.config) {
    $("status-name").textContent = state.name ? `${state.name}.toml` : "—";
    $("status-meta").textContent = "";
    $("category-note").textContent = "";
    return;
  }
  $("status-name").textContent = `${state.name}.toml`;
  $("status-meta").textContent =
    `${state.config.category} · ${state.config.size}px`;
  $("category-note").textContent = state.config.category;
}

/* ---------- stage messages ---------- */

function stageMessage(title, text, actions = []) {
  const box = $("stage-message");
  box.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = text || "";
  box.append(h, p);
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = `btn${action.primary ? " primary" : ""}`;
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    box.append(btn);
  }
  box.classList.remove("hidden");
  $("preview-canvas").classList.add("hidden");
}

function showEmptyState() {
  state.config = null;
  state.name = null;
  state.selectedSticker = null;
  previewRenderer.cancel();
  if (location.hash) history.replaceState(null, "", location.pathname);
  renderCategories();
  updateSaveState();
  updateStatusFooter();
  syncInspector();
  renderFilmstrip();
  stageMessage(
    "No configs yet",
    "Create a config to start designing. New configs use doc-base, a blue gradient and a Park sticker.",
    [{ label: "New config", primary: true, onClick: newConfig }],
  );
}

function showLoadError(err, name) {
  stageMessage(`Cannot load ${name}.toml`, err.message, [
    ...(err.toml
      ? [
          {
            label: "Edit TOML",
            primary: true,
            onClick: () => showRawDialog(name, err.toml, err.message),
          },
        ]
      : []),
    { label: "Retry", onClick: () => loadConfig(name) },
  ]);
  setStatusError(err.message);
}

/* ---------- load & refresh ---------- */

function updateHash() {
  if (!state.name) return;
  const hash = `#${encodeURIComponent(state.name)}`;
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

async function refreshAssets() {
  if (!state.name) {
    state.assets = [];
    return;
  }
  const data = await api(
    `/api/assets?config=${encodeURIComponent(state.name)}`,
  );
  state.assets = data.assets || [];
  state.patternGridKey = "";
  state.stickerAssetsKey = "";
}

async function loadConfig(name, options = {}) {
  if (state.switching) return false;
  state.switching = true;
  if (state.previewFrame) {
    cancelAnimationFrame(state.previewFrame);
    state.previewFrame = 0;
  }
  try {
    const data = await api(`/api/config/${encodeURIComponent(name)}`);
    state.name = data.name;
    state.config = data.config;
    state.mtime = data.mtime;
    state.dirty = false;
    state.saving = false;
    state.revision += 1;
    state.selectedSticker = data.config.stickers.length ? 0 : null;
    if (!data.config.ids[state.selectedId]) state.selectedId = "GreenId";
    try {
      await refreshAssets();
    } catch {
      state.assets = [];
    }
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    state.stopsKey = "";
    state.stickerListKey = "";
    state.patternGridKey = "";
    state.stickerAssetsKey = "";
    previewRenderer.cancel();
    restoreBackground();
    renderCategories();
    updateStatusFooter();
    updateSaveState();
    syncInspector();
    $("stage-message").classList.add("hidden");
    $("preview-canvas").classList.remove("hidden");
    setStatusError("");
    updateHash();
    renderPreview();
    return true;
  } catch (err) {
    state.name = name;
    state.config = null;
    state.dirty = false;
    previewRenderer.cancel();
    updateSaveState();
    updateStatusFooter();
    renderFilmstrip();
    syncInspector();
    showLoadError(err, name);
    updateHash();
    return false;
  } finally {
    state.switching = false;
    void options;
  }
}

async function refreshConfigs(options = {}) {
  const data = await api("/api/configs");
  const next = data.configs || [];
  const before = JSON.stringify(state.configs);
  state.configs = next;
  const after = JSON.stringify(state.configs);
  if (!options.silent || before !== after) renderFilmstrip();

  if (!state.name) return;
  const current = state.configs.find((c) => c.name === state.name);
  if (!current) {
    if (state.configs.length) {
      await loadConfig(state.configs[0].name);
    } else {
      showEmptyState();
    }
    return;
  }
  if (
    !options.skipReload &&
    !state.dirty &&
    !state.saving &&
    state.config &&
    current.mtime &&
    state.mtime &&
    current.mtime !== state.mtime
  ) {
    state.mtime = current.mtime;
    await loadConfig(state.name, { external: true });
  }
}

async function refreshAssetsIfChanged() {
  if (!state.name || state.switching) return;
  const name = state.name;
  try {
    const data = await api(`/api/assets?config=${encodeURIComponent(name)}`);
    if (state.name !== name) return;
    const next = data.assets || [];
    if (JSON.stringify(next) !== JSON.stringify(state.assets)) {
      state.assets = next;
      state.patternGridKey = "";
      state.stickerAssetsKey = "";
      syncInspector();
      renderPreview();
      refreshConfigs({ silent: true }).catch(() => {});
    }
  } catch {
    // ignore transient errors
  }
}

function startPolling() {
  setInterval(async () => {
    if (state.polling || state.switching) return;
    state.polling = true;
    try {
      await refreshConfigs({ silent: true });
      await refreshAssetsIfChanged();
    } catch {
      // ignore transient errors
    } finally {
      state.polling = false;
    }
  }, 3000);
}

/* ---------- filmstrip ---------- */

function renderFilmstrip() {
  const strip = $("filmstrip");
  strip.innerHTML = "";
  if (!state.configs.length) {
    const empty = document.createElement("div");
    empty.className = "film-empty";
    empty.textContent = "No configs";
    strip.append(empty);
    return;
  }
  for (const cfg of state.configs) {
    const btn = document.createElement("button");
    btn.className = "film-item";
    if (cfg.name === state.name) btn.classList.add("selected");
    if (cfg.error) btn.classList.add("error");
    btn.title = cfg.error ? `${cfg.name}\n${cfg.error}` : `${cfg.name}.toml`;
    if (cfg.thumb) {
      const img = document.createElement("img");
      img.src = cfg.thumb;
      img.alt = cfg.name;
      img.draggable = false;
      btn.append(img);
    }
    btn.addEventListener("click", () => switchConfig(cfg.name));
    strip.append(btn);
  }
}

async function switchConfig(name) {
  if (!name || name === state.name || state.switching) return;
  if (state.dirty) {
    await saveNow();
    if (state.dirty) {
      showToast("Save failed — staying on the current config", "error");
      return;
    }
  }
  await loadConfig(name);
}

function moveConfig(delta) {
  if (!state.configs.length) return;
  const names = state.configs.map((c) => c.name);
  let index = names.indexOf(state.name);
  if (index < 0) index = 0;
  const next = (index + delta + names.length) % names.length;
  switchConfig(names[next]);
}

/* ---------- categories / colors ---------- */

const CATEGORY_ICONS = {
  "doc-base":
    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  "folder-base": '<path d="M3 6h7l2 2h9v12H3z"/><path d="M3 10h18"/>',
  "pack-base":
    '<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v9l9 5 9-5V8"/><path d="M12 13v9"/>',
};
const GENERIC_CATEGORY_ICON =
  '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>';

function renderCategories() {
  const grid = $("category-grid");
  if (!grid) return;
  const categories = state.meta.categories.map((c) => c.name);
  if (state.config && !categories.includes(state.config.category)) {
    categories.push(state.config.category);
  }
  grid.innerHTML = "";
  for (const name of categories) {
    const btn = document.createElement("button");
    btn.className = "category-btn";
    btn.dataset.category = name;
    btn.title = name;
    if (state.config && state.config.category === name)
      btn.classList.add("active");
    btn.innerHTML = `<svg viewBox="0 0 24 24">${
      CATEGORY_ICONS[name] || GENERIC_CATEGORY_ICON
    }</svg>`;
    const label = document.createElement("span");
    label.textContent = name.replace("-base", "");
    btn.append(label);
    btn.addEventListener("click", () => {
      if (!state.config || state.config.category === name) return;
      state.config.category = name;
      markDirty();
    });
    grid.append(btn);
  }
}

function initIdList() {
  const list = $("id-list");
  list.innerHTML = "";
  for (const key of ID_KEYS) {
    const btn = document.createElement("button");
    btn.className = "id-row";
    btn.dataset.id = key;
    btn.title = key;
    const swatch = document.createElement("span");
    swatch.className = "id-swatch";
    const letter = document.createElement("span");
    letter.className = "id-letter";
    letter.textContent = ID_LETTER[key];
    const name = document.createElement("span");
    name.className = "id-name";
    name.textContent = key;
    btn.append(swatch, letter, name);
    btn.addEventListener("click", () => {
      state.selectedId = key;
      syncInspector();
    });
    list.append(btn);
  }
}

/* ---------- numeric pair bindings ---------- */

function bindPair(rangeId, numId, onChange) {
  const range = $(rangeId);
  const num = $(numId);
  const apply = (raw) => {
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    onChange(v);
    markDirty();
  };
  range.addEventListener("input", () => apply(range.value));
  num.addEventListener("input", () => apply(num.value));
  return (value) => {
    setValue(range, round4(value));
    setValue(num, round4(value));
  };
}

function initPairBindings() {
  pairs.angle = bindPair("angle-range", "angle-num", (v) => {
    const f = currentFill();
    if (f && f.type !== "solid" && f.type !== "pattern")
      f.angle = clamp(v, 0, 360);
  });
  pairs.cx = bindPair("cx-range", "cx-num", (v) => {
    const f = currentFill();
    if (f && f.cx !== undefined) f.cx = clamp(v, -1, 2);
  });
  pairs.cy = bindPair("cy-range", "cy-num", (v) => {
    const f = currentFill();
    if (f && f.cy !== undefined) f.cy = clamp(v, -1, 2);
  });
  pairs.radius = bindPair("radius-range", "radius-num", (v) => {
    const f = currentFill();
    if (f && f.radius !== undefined) f.radius = clamp(v, 0.01, 4);
  });
  pairs.patternScale = bindPair(
    "pattern-scale-range",
    "pattern-scale-num",
    (v) => {
      const f = currentFill();
      if (f && f.type === "pattern") f.scale = clamp(v, 0.01, 4);
    },
  );
  pairs.patternOx = bindPair("pattern-ox-range", "pattern-ox-num", (v) => {
    const f = currentFill();
    if (f && f.type === "pattern") f.offset_x = clamp(v, -4, 4);
  });
  pairs.patternOy = bindPair("pattern-oy-range", "pattern-oy-num", (v) => {
    const f = currentFill();
    if (f && f.type === "pattern") f.offset_y = clamp(v, -4, 4);
  });

  pairs.stickerX = bindPair("sticker-x-range", "sticker-x-num", (v) => {
    const s = currentSticker();
    if (s) s.x = clamp(v, -2, 3);
  });
  pairs.stickerY = bindPair("sticker-y-range", "sticker-y-num", (v) => {
    const s = currentSticker();
    if (s) s.y = clamp(v, -2, 3);
  });
  pairs.stickerScale = bindPair(
    "sticker-scale-range",
    "sticker-scale-num",
    (v) => {
      const s = currentSticker();
      if (s) s.scale = clamp(v, 0.005, 8);
    },
  );
  pairs.stickerRotation = bindPair(
    "sticker-rotation-range",
    "sticker-rotation-num",
    (v) => {
      const s = currentSticker();
      if (s) s.rotation = v;
    },
  );
  pairs.stickerOpacity = bindPair(
    "sticker-opacity-range",
    "sticker-opacity-num",
    (v) => {
      const s = currentSticker();
      if (s) s.opacity = clamp01(v);
    },
  );
  pairs.stickerOx = bindPair("sticker-ox-range", "sticker-ox-num", (v) => {
    const s = currentSticker();
    if (s) s.offset_x = clamp(v, -2, 2);
  });
  pairs.stickerOy = bindPair("sticker-oy-range", "sticker-oy-num", (v) => {
    const s = currentSticker();
    if (s) s.offset_y = clamp(v, -2, 2);
  });

  pairs.strokeWidth = bindPair(
    "stroke-width-range",
    "stroke-width-num",
    (v) => {
      const s = currentSticker();
      if (s) s.stroke.width = clamp(v, 0, 0.5);
    },
  );
  pairs.strokeOpacity = bindPair(
    "stroke-opacity-range",
    "stroke-opacity-num",
    (v) => {
      const s = currentSticker();
      if (s) s.stroke.opacity = clamp01(v);
    },
  );
  pairs.shadowBlur = bindPair("shadow-blur-range", "shadow-blur-num", (v) => {
    const s = currentSticker();
    if (s) s.shadow.blur = clamp(v, 0, 0.5);
  });
  pairs.shadowOpacity = bindPair(
    "shadow-opacity-range",
    "shadow-opacity-num",
    (v) => {
      const s = currentSticker();
      if (s) s.shadow.opacity = clamp01(v);
    },
  );
  pairs.shadowDx = bindPair("shadow-dx-range", "shadow-dx-num", (v) => {
    const s = currentSticker();
    if (s) s.shadow.dx = clamp(v, -0.5, 0.5);
  });
  pairs.shadowDy = bindPair("shadow-dy-range", "shadow-dy-num", (v) => {
    const s = currentSticker();
    if (s) s.shadow.dy = clamp(v, -0.5, 0.5);
  });
}

/* ---------- fill ui ---------- */

function defaultStopsFor(id) {
  if (id === "GreenId") {
    return [
      { offset: 0, color: "#1976d2" },
      { offset: 1, color: "#0a3d91" },
    ];
  }
  const base = ID_DEFAULT[id] || "#808080";
  return [
    { offset: 0, color: shadeHex(base, 0.18) },
    { offset: 1, color: shadeHex(base, -0.4) },
  ];
}

function stopsFromFill(fill, id) {
  if (fill && Array.isArray(fill.stops) && fill.stops.length >= 2) {
    return fill.stops.map((s) => ({ offset: s.offset, color: s.color }));
  }
  if (fill && fill.color) {
    return [
      { offset: 0, color: fill.color },
      { offset: 1, color: shadeHex(fill.color, -0.35) },
    ];
  }
  return defaultStopsFor(id);
}

function changeFillType(type) {
  const fill = currentFill();
  if (!fill || fill.type === type) return;
  const stops = stopsFromFill(fill, state.selectedId);
  let next;
  if (type === "solid") {
    next = { type: "solid", color: stops[0].color || "#1976d2" };
  } else if (type === "pattern") {
    next = {
      type: "pattern",
      source: findAsset(fill.source) ? fill.source : firstAssetName(),
      scale: fill.scale || 0.25,
      offset_x: fill.offset_x || 0,
      offset_y: fill.offset_y || 0,
    };
  } else {
    next = {
      type,
      angle: fill.angle ?? (type === "linear" ? 90 : 0),
      cx: fill.cx ?? 0.5,
      cy: fill.cy ?? 0.5,
      stops,
    };
    if (type === "radial") next.radius = fill.radius ?? 0.72;
  }
  state.config.ids[state.selectedId] = next;
  state.stopsKey = "";
  state.patternGridKey = "";
  markDirty();
}

function openColorPicker(anchor, color, onChange) {
  if (!window.ColorPicker) return;
  window.ColorPicker.open({
    anchor,
    color: normalizeHex(color, "#000000"),
    onChange,
  });
}

function renderStopsIfNeeded(fill) {
  const key = `${state.selectedId}|${fill.type}|${fill.stops ? fill.stops.length : 0}`;
  if (key === state.stopsKey) return;
  state.stopsKey = key;
  const wrap = $("stops");
  wrap.innerHTML = "";
  if (!fill.stops) return;
  fill.stops.forEach((stop, index) => {
    const row = document.createElement("div");
    row.className = "stop";
    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "stop-color";
    colorButton.title = "Stop color";
    colorButton.dataset.stopColor = String(index);
    const swatch = document.createElement("span");
    swatch.style.background = stop.color;
    colorButton.append(swatch);
    colorButton.addEventListener("click", () => {
      const f = currentFill();
      if (!f || !f.stops || !f.stops[index]) return;
      openColorPicker(colorButton, f.stops[index].color, (hex) => {
        const current = currentFill();
        if (!current || !current.stops || !current.stops[index]) return;
        current.stops[index].color = hex;
        swatch.style.background = hex;
        markDirty();
      });
    });

    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "1";
    range.step = "0.01";
    range.value = String(stop.offset);
    range.dataset.stopOffsetRange = String(index);

    const num = document.createElement("input");
    num.className = "num";
    num.type = "number";
    num.min = "0";
    num.max = "1";
    num.step = "0.01";
    num.value = String(round4(stop.offset));
    num.dataset.stopOffset = String(index);

    const remove = document.createElement("button");
    remove.className = "stop-remove";
    remove.textContent = "×";
    remove.title = "Remove stop";
    remove.dataset.stopRemove = String(index);
    remove.disabled = (fill.stops || []).length <= 2;

    row.append(colorButton, range, num, remove);
    wrap.append(row);

    const setOffset = (raw) => {
      const f = currentFill();
      if (!f || !f.stops) return;
      const v = clamp(Number(raw) || 0, 0, 1);
      f.stops[index].offset = v;
      markDirty();
    };
    range.addEventListener("input", () => setOffset(range.value));
    num.addEventListener("input", () => setOffset(num.value));
    remove.addEventListener("click", () => {
      const f = currentFill();
      if (!f || !f.stops || f.stops.length <= 2) return;
      f.stops.splice(index, 1);
      state.stopsKey = "";
      markDirty();
    });
  });
}

function addStop() {
  const fill = currentFill();
  if (!fill || !fill.stops) return;
  const stops = fill.stops
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.offset - b.offset);
  let bestGap = -1;
  let insertAt = 0.5;
  let color = stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const gap = stops[i].offset - stops[i - 1].offset;
    if (gap > bestGap) {
      bestGap = gap;
      insertAt = (stops[i].offset + stops[i - 1].offset) / 2;
      color = mixHex(stops[i - 1].color, stops[i].color, 0.5);
    }
  }
  if (bestGap < 0.02) {
    insertAt = Math.min(0.99, (stops[stops.length - 1].offset + 1) / 2);
    color = stops[stops.length - 1].color;
  }
  fill.stops.push({ offset: insertAt, color });
  state.stopsKey = "";
  markDirty();
}

function renderAssetGrid(container, selectedName, onPick) {
  container.innerHTML = "";
  if (!state.assets.length) {
    const empty = document.createElement("div");
    empty.className = "empty-hint";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "Drop PNG or SVG files into the config folder";
    container.append(empty);
    return;
  }
  for (const asset of state.assets) {
    const btn = document.createElement("button");
    btn.className = "asset-btn";
    btn.title = asset.file;
    if (
      selectedName &&
      (asset.name.toLowerCase() === String(selectedName).toLowerCase() ||
        asset.file.toLowerCase() === String(selectedName).toLowerCase())
    ) {
      btn.classList.add("selected");
    }
    const img = document.createElement("span");
    img.className = "asset-img";
    img.style.backgroundImage = `url("${asset.url}")`;
    const label = document.createElement("span");
    label.textContent = asset.file;
    btn.append(img, label);
    btn.addEventListener("click", () => onPick(asset));
    container.append(btn);
  }
}

/* ---------- sticker ui ---------- */

function newSticker(kind) {
  const isText = kind === "text";
  const source = firstAssetName();
  const sourceAsset = findAsset(source);
  const sourceIsArt = sourceAsset && sourceAsset.kind === "art";
  return {
    kind,
    x: 0.5,
    y: isText ? 0.82 : 0.5,
    offset_x: 0,
    offset_y: 0,
    scale: isText ? 0.16 : 0.45,
    rotation: 0,
    opacity: 1,
    color: "#ffffff",
    ...(isText
      ? {
          text: "Park",
          font: state.meta.defaultFont || "sans-serif",
          weight: 700,
          recolor: false,
        }
      : {
          source,
          recolor: !sourceIsArt,
        }),
    stroke: { enabled: false, color: "#ffffff", width: 0.012, opacity: 1 },
    shadow: {
      enabled: true,
      color: "#000000",
      opacity: 0.35,
      blur: 0.03,
      dx: 0,
      dy: 0.012,
    },
  };
}

function addSticker(kind) {
  if (!state.config) return;
  state.config.stickers.push(newSticker(kind));
  state.selectedSticker = state.config.stickers.length - 1;
  state.stickerListKey = "";
  markDirty();
}

function deleteSelectedSticker() {
  if (!state.config || state.selectedSticker === null) return;
  state.config.stickers.splice(state.selectedSticker, 1);
  if (!state.config.stickers.length) state.selectedSticker = null;
  else
    state.selectedSticker = Math.min(
      state.selectedSticker,
      state.config.stickers.length - 1,
    );
  state.stickerListKey = "";
  state.stickerAssetsKey = "";
  markDirty();
}

function moveSticker(delta) {
  if (!state.config || state.selectedSticker === null) return;
  const i = state.selectedSticker;
  const j = i + delta;
  if (j < 0 || j >= state.config.stickers.length) return;
  const list = state.config.stickers;
  [list[i], list[j]] = [list[j], list[i]];
  state.selectedSticker = j;
  state.stickerListKey = "";
  state.stickerAssetsKey = "";
  markDirty();
}

function stickerRowName(sticker) {
  if (sticker.kind === "text") return sticker.text || "Text";
  return (sticker.source || "Icon").replace(/\.[^.]+$/, "");
}

function renderStickerListIfNeeded() {
  const stickers = state.config ? state.config.stickers : [];
  const key = `${stickers.length}|${stickers
    .map((s) => `${s.kind}:${s.source || ""}`)
    .join(",")}|${state.selectedSticker}`;
  if (key === state.stickerListKey) return;
  state.stickerListKey = key;

  const list = $("sticker-list");
  list.innerHTML = "";
  stickers.forEach((sticker, index) => {
    const row = document.createElement("button");
    row.className = "sticker-row";
    row.dataset.index = String(index);
    if (index === state.selectedSticker) row.classList.add("selected");
    const thumb = document.createElement("span");
    thumb.className = "sticker-thumb";
    if (sticker.kind === "text") {
      thumb.classList.add("is-text");
      thumb.textContent = "T";
    } else {
      const asset = findAsset(sticker.source);
      if (asset) thumb.style.backgroundImage = `url("${asset.url}")`;
    }
    const name = document.createElement("span");
    name.className = "sticker-name";
    name.textContent = stickerRowName(sticker);
    const kind = document.createElement("span");
    kind.className = "sticker-kind";
    kind.textContent = sticker.kind === "text" ? "TEXT" : "ICON";
    row.append(thumb, name, kind);
    row.addEventListener("click", () => {
      state.selectedSticker = index;
      state.stickerListKey = "";
      state.stickerAssetsKey = "";
      syncInspector();
    });
    list.append(row);
  });

  const empty = $("sticker-empty");
  if (!stickers.length) {
    empty.textContent = "No stickers yet. Add an icon or a text sticker.";
    empty.classList.remove("hidden");
  } else if (state.selectedSticker === null) {
    empty.textContent = "Select a sticker to edit it.";
  }
}

function updateSelectedStickerRowLabel() {
  const sticker = currentSticker();
  if (!sticker) return;
  const row = document.querySelector(
    `#sticker-list .sticker-row[data-index="${state.selectedSticker}"]`,
  );
  if (!row) return;
  const name = row.querySelector(".sticker-name");
  if (name) name.textContent = stickerRowName(sticker);
}

function syncStickerEditor() {
  const sticker = currentSticker();
  const has = Boolean(sticker);
  $("sticker-editor").classList.toggle("hidden", !has);
  $("sticker-empty").classList.toggle("hidden", has);
  if (!has) {
    return;
  }

  $("sticker-kind").textContent = sticker.kind.toUpperCase();
  $("sticker-icon-pane").classList.toggle("hidden", sticker.kind !== "icon");
  $("sticker-text-pane").classList.toggle("hidden", sticker.kind !== "text");

  if (sticker.kind === "icon") {
    const key = `${state.selectedSticker}|${sticker.source}|${assetsSignature()}`;
    if (key !== state.stickerAssetsKey) {
      state.stickerAssetsKey = key;
      renderAssetGrid($("sticker-assets"), sticker.source, (asset) => {
        const s = currentSticker();
        if (!s) return;
        s.source = asset.file;
        state.stickerListKey = "";
        state.stickerAssetsKey = "";
        markDirty();
      });
    }
    $("icon-recolor").checked = Boolean(sticker.recolor);
    const color = normalizeHex(sticker.color || "#ffffff", "#ffffff");
    $("icon-color-swatch").style.background = color;
  } else {
    setValue($("text-value"), sticker.text);
    ensureFontOption(sticker.font);
    setValue($("text-font"), sticker.font);
    setValue($("text-weight"), String(sticker.weight));
    const color = normalizeHex(sticker.color || "#ffffff", "#ffffff");
    $("text-color-swatch").style.background = color;
  }

  pairs.stickerX(sticker.x);
  pairs.stickerY(sticker.y);
  pairs.stickerScale(sticker.scale);
  pairs.stickerRotation(sticker.rotation);
  pairs.stickerOpacity(sticker.opacity);
  pairs.stickerOx(sticker.offset_x);
  pairs.stickerOy(sticker.offset_y);

  $("stroke-enabled").checked = Boolean(sticker.stroke.enabled);
  const strokeColor = normalizeHex(sticker.stroke.color, "#ffffff");
  $("stroke-color-swatch").style.background = strokeColor;
  pairs.strokeWidth(sticker.stroke.width);
  pairs.strokeOpacity(sticker.stroke.opacity);

  $("shadow-enabled").checked = Boolean(sticker.shadow.enabled);
  const shadowColor = normalizeHex(sticker.shadow.color, "#000000");
  $("shadow-color-swatch").style.background = shadowColor;
  pairs.shadowBlur(sticker.shadow.blur);
  pairs.shadowOpacity(sticker.shadow.opacity);
  pairs.shadowDx(sticker.shadow.dx);
  pairs.shadowDy(sticker.shadow.dy);

  $("sticker-up").disabled = state.selectedSticker <= 0;
  $("sticker-down").disabled =
    state.selectedSticker >= (state.config.stickers.length || 0) - 1;
}

/* ---------- inspector sync ---------- */

function syncInspector() {
  if (!state.config) {
    $$("#category-grid .category-btn").forEach((btn) =>
      btn.classList.remove("active"),
    );
    $$("#id-list .id-row").forEach((row) => {
      row.classList.remove("active");
      const swatch = row.querySelector(".id-swatch");
      if (swatch) {
        swatch.style.backgroundImage = "";
        swatch.style.backgroundColor = "#ffffff";
      }
    });
    $("sticker-list").innerHTML = "";
    $("sticker-editor").classList.add("hidden");
    $("sticker-empty").textContent = "No config selected";
    $("sticker-empty").classList.remove("hidden");
    $("canvas-wrap").classList.remove("can-drag");
    $("sticker-marker").classList.add("hidden");
    updateSaveState();
    return;
  }
  const config = state.config;
  $$("#category-grid .category-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === config.category);
  });

  for (const key of ID_KEYS) {
    const row = document.querySelector(`#id-list .id-row[data-id="${key}"]`);
    if (!row) continue;
    row.classList.toggle("active", key === state.selectedId);
    const swatch = row.querySelector(".id-swatch");
    applyFillBackground(swatch, config.ids[key]);
  }

  const fill = config.ids[state.selectedId] || {
    type: "solid",
    color: "#777777",
  };
  $("fill-title").textContent = state.selectedId;
  $("fill-role").textContent = ID_ROLE[state.selectedId] || "";
  $$("#fill-types button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.fill === fill.type);
  });
  const activePane =
    fill.type === "solid"
      ? "pane-solid"
      : fill.type === "pattern"
        ? "pane-pattern"
        : "pane-gradient";
  for (const paneId of ["pane-solid", "pane-gradient", "pane-pattern"]) {
    $(paneId).classList.toggle("active", paneId === activePane);
  }

  if (fill.type === "solid") {
    const color = normalizeHex(fill.color || "#777777", "#777777");
    setValue($("solid-hex"), color);
    $("solid-swatch").style.background = fillCss(fill);
    $("solid-code").textContent = color.toUpperCase();
  }

  if (["linear", "radial", "conic"].includes(fill.type)) {
    renderStopsIfNeeded(fill);
    $("grad-bar").style.background = fillCss(fill);
    $("field-angle").classList.toggle("hidden", fill.type === "radial");
    $("field-cx").classList.toggle("hidden", fill.type === "linear");
    $("field-cy").classList.toggle("hidden", fill.type === "linear");
    $("field-radius").classList.toggle("hidden", fill.type !== "radial");
    pairs.angle(fill.angle ?? 0);
    pairs.cx(fill.cx ?? 0.5);
    pairs.cy(fill.cy ?? 0.5);
    pairs.radius(fill.radius ?? 0.72);
  }

  if (fill.type === "pattern") {
    const key = `${state.selectedId}|${fill.source}|${assetsSignature()}`;
    if (key !== state.patternGridKey) {
      state.patternGridKey = key;
      renderAssetGrid($("pattern-grid"), fill.source, (asset) => {
        const f = currentFill();
        if (!f || f.type !== "pattern") return;
        f.source = asset.file;
        state.patternGridKey = "";
        markDirty();
      });
    }
    pairs.patternScale(fill.scale);
    pairs.patternOx(fill.offset_x);
    pairs.patternOy(fill.offset_y);
  }

  renderStickerListIfNeeded();
  if (!state.config.stickers.length) {
    $("sticker-list").innerHTML = "";
    $("sticker-empty").classList.remove("hidden");
  }
  syncStickerEditor();

  const wrap = $("canvas-wrap");
  wrap.classList.toggle("can-drag", Boolean(currentSticker()));
  updateStickerMarker();
  updateStatusFooter();
}

/* ---------- assets / fonts ---------- */

function populateFonts() {
  const select = $("text-font");
  select.innerHTML = "";
  const fonts = state.meta.fonts.slice();
  const current = currentSticker();
  if (current && current.kind === "text" && !fonts.includes(current.font)) {
    fonts.unshift(current.font);
  }
  for (const font of fonts) {
    const option = document.createElement("option");
    option.value = font;
    option.textContent = font;
    select.append(option);
  }
}

function ensureFontOption(font) {
  if (!font) return;
  const select = $("text-font");
  const exists = Array.from(select.options).some((o) => o.value === font);
  if (exists) return;
  const option = document.createElement("option");
  option.value = font;
  option.textContent = font;
  select.append(option);
}

/* ---------- config operations ---------- */

function newConfig() {
  const existing = new Set(state.configs.map((c) => c.name));
  let value = "untitled";
  for (let i = 2; existing.has(value); i++) value = `untitled-${i}`;
  promptDialog({
    title: "New config",
    label:
      "Name the TOML file. Letters, digits, dot, dash and underscore only.",
    value,
    confirmLabel: "Create",
    onConfirm: async (name) => {
      if (state.dirty) {
        await saveNow();
        if (state.dirty) throw new Error("Save the current config first");
      }
      const created = await api("/api/config", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await refreshConfigs({ silent: true });
      await loadConfig(created.name);
      showToast(`Created ${created.name}.toml`);
    },
  });
}

function duplicateConfig() {
  if (!state.name) return;
  const existing = new Set(state.configs.map((c) => c.name));
  let value = `${state.name}-2`;
  for (let i = 3; existing.has(value); i++) value = `${state.name}-${i}`;
  promptDialog({
    title: "Duplicate config",
    label: "Copy this config and its assets under a new name.",
    value,
    confirmLabel: "Duplicate",
    onConfirm: async (name) => {
      if (state.dirty) {
        await saveNow();
        if (state.dirty) throw new Error("Save the current config first");
      }
      const created = await api("/api/config", {
        method: "POST",
        body: JSON.stringify({ name, duplicateOf: state.name }),
      });
      await refreshConfigs({ silent: true });
      await loadConfig(created.name);
      showToast(`Duplicated to ${created.name}.toml`);
    },
  });
}

function deleteConfig() {
  if (!state.name) return;
  const name = state.name;
  confirmDialog({
    title: "Delete config",
    message: `Delete configs/${name}.toml and its asset folder? This cannot be undone.`,
    confirmLabel: "Delete",
    onConfirm: async () => {
      await api(`/api/config/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      state.dirty = false;
      state.saveTimer = null;
      await refreshConfigs({ silent: true });
      if (!state.configs.length) showEmptyState();
      showToast(`Deleted ${name}.toml`);
    },
  });
}

/* ---------- generate ---------- */

async function openArtStudio() {
  if (!state.name || !state.config) {
    showToast("Load a config before opening the art studio", "error");
    return;
  }
  if (!window.ArtStudio) {
    showToast("Art studio script is not loaded", "error");
    return;
  }
  if (state.dirty) {
    await saveNow();
    if (state.dirty) {
      showToast("Save failed — cannot open the art studio", "error");
      return;
    }
  }
  window.ArtStudio.open({
    configName: state.name,
    onClose: async () => {
      try {
        await refreshAssets();
        state.patternGridKey = "";
        state.stickerAssetsKey = "";
        syncInspector();
        renderPreview();
        await refreshConfigs({ silent: true });
      } catch (err) {
        showToast(err.message, "error");
      }
    },
  });
}

async function generateArtifacts(force = false) {
  if (state.dirty) {
    await saveNow();
    if (state.dirty) {
      showToast("Save failed — cannot generate", "error");
      return;
    }
  }
  const buttons = [$("btn-generate"), $("btn-generate-2")];
  buttons.forEach((b) => b.classList.add("busy"));
  try {
    const result = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ force }),
    });
    const { summary } = result;
    const failed = result.results.filter((r) => r.status === "error");
    showToast(
      `Generated ${summary.created + summary.updated} · unchanged ${summary.skipped}${
        summary.errors ? ` · ${summary.errors} failed` : ""
      }`,
      failed.length ? "error" : "ok",
    );
    setStatusError(
      failed.length
        ? failed.map((r) => `${r.name}: ${r.error}`).join("\n")
        : "",
    );
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    buttons.forEach((b) => b.classList.remove("busy"));
  }
}

/* ---------- raw toml / help ---------- */

function showRawDialog(name, initialToml, initialError) {
  const ui = makeOverlay({ title: `TOML · ${name}.toml`, wide: true });
  const textarea = document.createElement("textarea");
  textarea.className = "raw-area";
  textarea.spellcheck = false;
  textarea.value = initialToml || "";
  const error = document.createElement("div");
  error.className = `error-text${initialError ? "" : " hidden"}`;
  error.textContent = initialError || "";
  ui.body.append(textarea, error);
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "Cancel";
  const apply = document.createElement("button");
  apply.className = "btn primary";
  apply.textContent = "Apply";
  ui.foot.append(cancel, apply);
  cancel.addEventListener("click", ui.close);

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    }
  });

  let busy = false;
  apply.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    apply.disabled = true;
    try {
      const saved = await api(`/api/config/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: JSON.stringify({ toml: textarea.value }),
      });
      ui.close();
      state.dirty = false;
      state.mtime = saved.mtime;
      await refreshConfigs({ silent: true });
      await loadConfig(name);
      showToast("TOML saved");
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("hidden");
      apply.disabled = false;
      busy = false;
    }
  });

  setTimeout(() => textarea.focus(), 0);
}

async function openRawEditor() {
  if (!state.name) return;
  if (state.dirty) await saveNow();
  try {
    const data = await api(`/api/config/${encodeURIComponent(state.name)}/raw`);
    showRawDialog(state.name, data.toml);
  } catch (err) {
    if (err.toml) showRawDialog(state.name, err.toml, err.message);
    else showToast(err.message, "error");
  }
}

function showHelp() {
  const ui = makeOverlay({ title: "Shortcuts", wide: false });
  const grid = document.createElement("div");
  grid.className = "shortcut-grid";
  const shortcuts = [
    ["Previous / next config", "[  ]  or  J  K"],
    ["Move sticker", "Arrow keys"],
    ["Move sticker fast", "Shift + Arrows"],
    ["Rotate sticker", "Alt + ← →"],
    ["Drag a sticker", "Drag the preview"],
    ["Scale sticker", "Wheel on preview"],
    ["Rotate sticker", "Shift + Wheel"],
    ["Opacity sticker", "Alt + Wheel"],
    ["Center sticker", "Double-click preview"],
    ["Select color ID", "1  2  3"],
    ["New config", "N"],
    ["Duplicate config", "D"],
    ["Edit raw TOML", "E"],
    ["Art studio", "A"],
    ["Generate artifacts", "G"],
    ["Force generate", "Shift + G"],
    ["Save now", "Ctrl / ⌘ + S"],
    ["Delete sticker", "Delete"],
    ["Delete config", "Shift + Delete"],
    ["Cycle background", "B"],
    ["Close / deselect", "Esc"],
  ];
  for (const [label, keys] of shortcuts) {
    const row = document.createElement("div");
    row.className = "shortcut";
    const span = document.createElement("span");
    span.textContent = label;
    const kbd = document.createElement("kbd");
    kbd.textContent = keys;
    row.append(span, kbd);
    grid.append(row);
  }
  ui.body.append(grid);
  const note = document.createElement("div");
  note.className = "help-note";
  note.textContent =
    "The preview is drawn live in Canvas and does not call the server. Click any color block or gradient stop for the custom picker; Esc reverts it. Changes autosave to configs/*.toml. Config assets live in configs/{name}/ (PNG, SVG, or grid-art TOML under art/). Generate writes artifact/{name}.png incrementally with the Node renderer. Press A for the art studio.";
  ui.body.append(note);
  const close = document.createElement("button");
  close.className = "btn primary";
  close.textContent = "Close";
  close.addEventListener("click", ui.close);
  ui.foot.append(close);
}

/* ---------- drag & wheel ---------- */

let drag = null;

function initStageInteraction() {
  const wrap = $("canvas-wrap");
  const img = $("preview-canvas");

  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const sticker = currentSticker();
    if (!sticker) return;
    const rect = img.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: sticker.x,
      y: sticker.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      moved: false,
    };
    wrap.classList.add("dragging");
    wrap.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  wrap.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const sticker = currentSticker();
    if (!sticker) return;
    const dx = (event.clientX - drag.startX) / drag.width;
    const dy = (event.clientY - drag.startY) / drag.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) drag.moved = true;
    sticker.x = clamp(drag.x + dx, -2, 3);
    sticker.y = clamp(drag.y + dy, -2, 3);
    markDirty();
  });

  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    wrap.classList.remove("dragging");
    schedulePreview(20);
  };
  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);

  wrap.addEventListener("dblclick", () => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.x = 0.5;
    sticker.y = 0.5;
    markDirty();
  });

  wrap.addEventListener(
    "wheel",
    (event) => {
      const sticker = currentSticker();
      if (!sticker) return;
      event.preventDefault();
      if (event.shiftKey) {
        sticker.rotation = (sticker.rotation || 0) + -event.deltaY * 0.08;
      } else if (event.altKey) {
        sticker.opacity = clamp01(
          (sticker.opacity ?? 1) - event.deltaY * 0.001,
        );
      } else {
        sticker.scale = clamp(
          (sticker.scale || 1) * Math.exp(-event.deltaY * 0.0015),
          0.005,
          8,
        );
      }
      markDirty();
    },
    { passive: false },
  );

  img.addEventListener("dragstart", (e) => e.preventDefault());
  window.addEventListener("resize", updateStickerMarker);
}

/* ---------- background ---------- */

const BACKGROUNDS = ["bg-checker", "bg-white", "bg-black"];

function restoreBackground() {
  const saved = Number(localStorage.getItem("ico.bg") || 0);
  state.bg = Number.isFinite(saved)
    ? ((saved % BACKGROUNDS.length) + BACKGROUNDS.length) % BACKGROUNDS.length
    : 0;
  applyBackground();
}

function applyBackground() {
  const wrap = $("canvas-wrap");
  BACKGROUNDS.forEach((cls) => wrap.classList.remove(cls));
  wrap.classList.add(BACKGROUNDS[state.bg]);
  localStorage.setItem("ico.bg", String(state.bg));
}

function cycleBackground() {
  state.bg = (state.bg + 1) % BACKGROUNDS.length;
  applyBackground();
}

/* ---------- static bindings ---------- */

function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function initStatic() {
  initIdList();
  initPairBindings();

  $("btn-new").addEventListener("click", newConfig);
  $("btn-duplicate").addEventListener("click", duplicateConfig);
  $("btn-delete").addEventListener("click", deleteConfig);
  $("btn-art").addEventListener("click", openArtStudio);
  $("btn-raw").addEventListener("click", openRawEditor);
  $("btn-help").addEventListener("click", showHelp);
  $("btn-generate").addEventListener("click", () => generateArtifacts(false));
  $("btn-generate-2").addEventListener("click", () => generateArtifacts(false));

  $$("#fill-types button").forEach((btn) => {
    btn.addEventListener("click", () => changeFillType(btn.dataset.fill));
  });

  $("solid-color").addEventListener("click", () => {
    const fill = currentFill();
    if (!fill || fill.type !== "solid") return;
    openColorPicker($("solid-color"), fill.color, (hex) => {
      const current = currentFill();
      if (!current || current.type !== "solid") return;
      current.color = hex;
      markDirty();
    });
  });
  $("solid-hex").addEventListener("input", (e) => {
    const fill = currentFill();
    if (!fill) return;
    if (/^#?(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.target.value.trim())) {
      fill.color = normalizeHex(e.target.value, fill.color || "#1976d2");
      markDirty();
    }
  });
  $("solid-hex").addEventListener("blur", () => {
    const fill = currentFill();
    if (fill) setValue($("solid-hex"), normalizeHex(fill.color, "#000000"));
  });

  $("add-stop").addEventListener("click", addStop);

  $("add-icon").addEventListener("click", () => addSticker("icon"));
  $("add-text").addEventListener("click", () => addSticker("text"));
  $("sticker-delete").addEventListener("click", deleteSelectedSticker);
  $("sticker-up").addEventListener("click", () => moveSticker(-1));
  $("sticker-down").addEventListener("click", () => moveSticker(1));

  $("icon-recolor").addEventListener("change", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.recolor = e.target.checked;
    if (sticker.recolor && !sticker.color) sticker.color = "#ffffff";
    markDirty();
  });
  $("icon-color").addEventListener("click", () => {
    const sticker = currentSticker();
    if (!sticker) return;
    openColorPicker($("icon-color"), sticker.color || "#ffffff", (hex) => {
      const current = currentSticker();
      if (!current) return;
      current.color = hex;
      current.recolor = true;
      markDirty();
    });
  });

  $("text-value").addEventListener("input", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    const clean = e.target.value.replace(/[^\x20-\x7E]/g, "");
    if (clean !== e.target.value) e.target.value = clean;
    sticker.text = clean;
    updateSelectedStickerRowLabel();
    markDirty();
  });
  $("text-font").addEventListener("change", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.font = e.target.value;
    markDirty();
  });
  $("text-weight").addEventListener("change", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.weight = Number(e.target.value) || 700;
    markDirty();
  });
  $("text-color").addEventListener("click", () => {
    const sticker = currentSticker();
    if (!sticker) return;
    openColorPicker($("text-color"), sticker.color || "#ffffff", (hex) => {
      const current = currentSticker();
      if (!current) return;
      current.color = hex;
      markDirty();
    });
  });

  $("stroke-enabled").addEventListener("change", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.stroke.enabled = e.target.checked;
    markDirty();
  });
  $("stroke-color").addEventListener("click", () => {
    const sticker = currentSticker();
    if (!sticker) return;
    openColorPicker($("stroke-color"), sticker.stroke.color, (hex) => {
      const current = currentSticker();
      if (!current) return;
      current.stroke.color = hex;
      markDirty();
    });
  });

  $("shadow-enabled").addEventListener("change", (e) => {
    const sticker = currentSticker();
    if (!sticker) return;
    sticker.shadow.enabled = e.target.checked;
    markDirty();
  });
  $("shadow-color").addEventListener("click", () => {
    const sticker = currentSticker();
    if (!sticker) return;
    openColorPicker($("shadow-color"), sticker.shadow.color, (hex) => {
      const current = currentSticker();
      if (!current) return;
      current.shadow.color = hex;
      markDirty();
    });
  });

  initStageInteraction();

  window.addEventListener("keydown", (event) => {
    if (
      document.querySelector(".overlay") ||
      document.querySelector(".cp-panel") ||
      document.querySelector(".studio-overlay")
    ) {
      return;
    }
    const editable = isEditable(event.target);
    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") {
      event.preventDefault();
      saveNow();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;

    if (editable) {
      if (key === "Escape") event.target.blur();
      return;
    }

    if (key === "?" || (key === "/" && event.shiftKey)) {
      event.preventDefault();
      showHelp();
      return;
    }
    if (key === "Escape") {
      if (!isEditable(event.target)) {
        state.selectedSticker = null;
        state.stickerListKey = "";
        syncInspector();
      }
      return;
    }

    const lower = key.toLowerCase();
    if (lower === "n") {
      event.preventDefault();
      newConfig();
      return;
    }
    if (lower === "d") {
      event.preventDefault();
      duplicateConfig();
      return;
    }
    if (lower === "e") {
      event.preventDefault();
      openRawEditor();
      return;
    }
    if (lower === "a") {
      event.preventDefault();
      openArtStudio();
      return;
    }
    if (lower === "g") {
      event.preventDefault();
      generateArtifacts(event.shiftKey);
      return;
    }
    if (lower === "b") {
      event.preventDefault();
      cycleBackground();
      return;
    }
    if (lower === "j") {
      event.preventDefault();
      moveConfig(1);
      return;
    }
    if (lower === "k") {
      event.preventDefault();
      moveConfig(-1);
      return;
    }
    if (key === "]") {
      event.preventDefault();
      moveConfig(1);
      return;
    }
    if (key === "[") {
      event.preventDefault();
      moveConfig(-1);
      return;
    }
    if (key === "1" || key === "2" || key === "3") {
      event.preventDefault();
      state.selectedId = ID_KEYS[Number(key) - 1];
      syncInspector();
      return;
    }

    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      if (event.shiftKey) deleteConfig();
      else if (state.selectedSticker !== null) deleteSelectedSticker();
      return;
    }

    const sticker = currentSticker();
    if (sticker && key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 0.02 : 0.005;
      if (event.altKey) {
        if (key === "ArrowLeft" || key === "ArrowRight") {
          const delta =
            (event.shiftKey ? 10 : 1) * (key === "ArrowLeft" ? -1 : 1);
          sticker.rotation = (sticker.rotation || 0) + delta;
        }
      } else if (key === "ArrowLeft")
        sticker.x = clamp(sticker.x - step, -2, 3);
      else if (key === "ArrowRight") sticker.x = clamp(sticker.x + step, -2, 3);
      else if (key === "ArrowUp") sticker.y = clamp(sticker.y - step, -2, 3);
      else if (key === "ArrowDown") sticker.y = clamp(sticker.y + step, -2, 3);
      markDirty();
      return;
    }

    if (key === "ArrowLeft" || key === "ArrowUp") {
      event.preventDefault();
      moveConfig(-1);
    } else if (key === "ArrowRight" || key === "ArrowDown") {
      event.preventDefault();
      moveConfig(1);
    }
  });

  window.addEventListener("hashchange", () => {
    const name = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (name && name !== state.name) switchConfig(name);
  });

  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

/* ---------- boot ---------- */

async function boot() {
  initStatic();
  restoreBackground();
  stageMessage("Loading", "Reading configs and system fonts…");
  try {
    state.meta = await api("/api/meta");
  } catch (err) {
    showToast(`Could not load editor metadata: ${err.message}`, "error");
  }
  populateFonts();
  try {
    await refreshConfigs({ silent: true });
  } catch (err) {
    showToast(err.message, "error");
  }
  const hashName = decodeURIComponent(location.hash.replace(/^#/, ""));
  let initial = state.configs.find((c) => c.name === hashName)?.name;
  if (!initial) initial = state.configs[0]?.name;
  if (initial) await loadConfig(initial);
  else showEmptyState();
  startPolling();
}

boot();
