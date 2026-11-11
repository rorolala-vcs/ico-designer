"use strict";

(function () {
  let active = null;

  const PRESETS = [
    "#ffffff",
    "#f2f2ee",
    "#c9c9c2",
    "#8a8a84",
    "#4a4a46",
    "#111111",
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

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function clamp01(n) {
    return clamp(n, 0, 1);
  }

  function normalizeHex(value, fallback) {
    if (typeof value !== "string") return fallback;
    let s = value.trim().toLowerCase();
    if (s.startsWith("#")) s = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(s)) {
      return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
    }
    if (/^[0-9a-f]{4}$/.test(s)) {
      return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
    }
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    if (/^[0-9a-f]{8}$/.test(s)) return `#${s}`;
    return fallback;
  }

  function parseHex(value) {
    const hex = normalizeHex(value, "#000000");
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1,
    };
  }

  function toHex(color) {
    const h = (n) =>
      Math.round(clamp(n, 0, 255))
        .toString(16)
        .padStart(2, "0");
    const rgb = `${h(color.r)}${h(color.g)}${h(color.b)}`;
    if (color.a >= 0.999) return `#${rgb}`;
    return `#${rgb}${h(color.a * 255)}`;
  }

  function cssColor(color) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(
      color.b,
    )}, ${clamp01(color.a)})`;
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d > 1e-6) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max <= 0 ? 0 : d / max, v: max };
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = v - c;
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
    };
  }

  function bindDrag(el, onMove) {
    let activeDrag = false;
    const move = (event) => {
      const rect = el.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const y = clamp(event.clientY - rect.top, 0, rect.height);
      onMove(
        rect.width ? x / rect.width : 0,
        rect.height ? y / rect.height : 0,
      );
    };
    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      activeDrag = true;
      el.setPointerCapture(event.pointerId);
      move(event);
      event.preventDefault();
    });
    el.addEventListener("pointermove", (event) => {
      if (activeDrag) move(event);
    });
    const end = (event) => {
      if (!activeDrag) return;
      activeDrag = false;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function open(options) {
    closeActive();
    const anchor = options.anchor || null;
    const initial = parseHex(options.color || "#000000");
    const initialHex = toHex(initial);
    const hsv = rgbToHsv(initial.r, initial.g, initial.b);
    let alpha = initial.a;
    let onChange = options.onChange || (() => {});

    const backdrop = document.createElement("div");
    backdrop.className = "cp-backdrop";
    const panel = document.createElement("div");
    panel.className = "cp-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Color picker");
    panel.innerHTML = `
      <div class="cp-head">
        <span class="cp-title">Color</span>
        <button class="mini-btn" data-close title="Close">×</button>
      </div>
      <div class="cp-sv" data-sv><i class="cp-sv-cursor" data-sv-cursor></i></div>
      <div class="cp-strip cp-hue" data-hue><i class="cp-knob" data-hue-knob></i></div>
      <div class="cp-strip cp-alpha" data-alpha>
        <span class="cp-checker"></span>
        <span class="cp-alpha-grad" data-alpha-grad></span>
        <i class="cp-knob" data-alpha-knob></i>
      </div>
      <div class="cp-row">
        <span class="cp-preview"><i data-preview></i></span>
        <input class="cp-hex" data-hex spellcheck="false" autocomplete="off" aria-label="Hex color">
        <input class="cp-alpha-num" data-alpha-num type="number" min="0" max="100" step="1" aria-label="Alpha percent">
      </div>
      <div class="cp-presets" data-presets></div>
      <div class="cp-foot">
        <button class="btn" data-revert>Revert</button>
        <button class="btn primary" data-done>Done</button>
      </div>`;

    document.body.append(backdrop, panel);

    const el = (name) => panel.querySelector(`[data-${name}]`);
    const sv = el("sv");
    const svCursor = el("sv-cursor");
    const hue = el("hue");
    const hueKnob = el("hue-knob");
    const alphaEl = el("alpha");
    const alphaGrad = el("alpha-grad");
    const alphaKnob = el("alpha-knob");
    const preview = el("preview");
    const hexInput = el("hex");
    const alphaNum = el("alpha-num");
    const presets = el("presets");

    for (const hex of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cp-preset";
      btn.title = hex;
      btn.style.background = hex;
      btn.addEventListener("click", () => {
        const c = parseHex(hex);
        Object.assign(hsv, rgbToHsv(c.r, c.g, c.b));
        alpha = 1;
        emit();
      });
      presets.append(btn);
    }

    const rect = anchor
      ? anchor.getBoundingClientRect()
      : { left: 24, right: 24, top: 80, bottom: 80 };
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    const maxLeft = Math.max(12, window.innerWidth - pw - 12);
    let left = clamp(rect.left, 12, maxLeft);
    let top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 12) {
      top = Math.max(12, rect.top - ph - 8);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;

    function currentColor() {
      const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
      return { ...rgb, a: alpha };
    }

    function updateUI() {
      const color = currentColor();
      const rgb = `rgb(${color.r}, ${color.g}, ${color.b})`;
      sv.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
      svCursor.style.left = `${hsv.s * 100}%`;
      svCursor.style.top = `${(1 - hsv.v) * 100}%`;
      hueKnob.style.left = `${(hsv.h / 360) * 100}%`;
      alphaKnob.style.left = `${alpha * 100}%`;
      alphaGrad.style.background = `linear-gradient(to right, rgba(${color.r}, ${color.g}, ${color.b}, 0), ${rgb})`;
      preview.style.background = cssColor(color);
      if (document.activeElement !== hexInput) {
        hexInput.value = toHex(color);
      }
      if (document.activeElement !== alphaNum) {
        alphaNum.value = String(Math.round(alpha * 100));
      }
    }

    function emit() {
      updateUI();
      onChange(toHex(currentColor()));
    }

    function setFromHex(value) {
      const normalized = normalizeHex(value, null);
      if (!normalized) return false;
      const c = parseHex(normalized);
      Object.assign(hsv, rgbToHsv(c.r, c.g, c.b));
      alpha = c.a;
      emit();
      return true;
    }

    bindDrag(sv, (x, y) => {
      hsv.s = clamp01(x);
      hsv.v = clamp01(1 - y);
      emit();
    });
    bindDrag(hue, (x) => {
      hsv.h = clamp(x, 0, 1) * 360;
      emit();
    });
    bindDrag(alphaEl, (x) => {
      alpha = clamp01(x);
      emit();
    });

    hexInput.addEventListener("input", () => {
      if (/^#?[0-9a-f]{3,8}$/i.test(hexInput.value.trim())) {
        setFromHex(hexInput.value);
      }
    });
    hexInput.addEventListener("blur", updateUI);
    alphaNum.addEventListener("input", () => {
      const value = Number(alphaNum.value);
      if (Number.isFinite(value)) {
        alpha = clamp(value, 0, 100) / 100;
        emit();
      }
    });

    el("close").addEventListener("click", () => closePanel());
    el("done").addEventListener("click", () => closePanel());
    el("revert").addEventListener("click", () => {
      onChange(initialHex);
      closePanel();
    });
    backdrop.addEventListener("pointerdown", () => closePanel());
    backdrop.addEventListener("wheel", (event) => event.preventDefault(), {
      passive: false,
    });
    panel.addEventListener("wheel", (event) => event.preventDefault(), {
      passive: false,
    });

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onChange(initialHex);
        closePanel();
      }
    }
    document.addEventListener("keydown", onKey, true);

    function closePanel() {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      panel.remove();
      active = null;
    }

    active = { close: closePanel, panel, anchor };
    updateUI();
  }

  function closeActive() {
    if (!active) return;
    const current = active;
    active = null;
    current.close(false);
  }

  window.ColorPicker = { open, close: closeActive };
})();
