'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { paths } = require('./paths');

const CACHE_FILE = path.join(paths.cache, 'fonts.json');
const CACHE_TTL = 24 * 60 * 60 * 1000;
const FALLBACK = [
  'sans-serif',
  'serif',
  'monospace',
  'Arial',
  'Segoe UI',
  'Helvetica Neue',
  'Verdana',
  'Tahoma',
  'Georgia',
  'Trebuchet MS',
  'Courier New',
  'DejaVu Sans',
  'Noto Sans',
  'Liberation Sans',
];
const PREFERRED = ['Segoe UI', 'Arial', 'Helvetica Neue', 'Noto Sans', 'DejaVu Sans'];

let memory = null;
let pending = null;

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout || 15000,
        maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

function cleanNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const name = String(raw || '')
      .replace(/^@+/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function windowsFonts() {
  const script = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
    'Add-Type -AssemblyName System.Drawing;',
    '(New-Object System.Drawing.Text.InstalledFontCollection).Families |',
    'ForEach-Object { $_.Name }',
  ].join(' ');
  const stdout = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function fontconfigFonts() {
  const stdout = await run('fc-list', [':', 'family']);
  return stdout
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readCache() {
  try {
    const raw = await fsp.readFile(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (
      data &&
      Array.isArray(data.fonts) &&
      data.fonts.length > 0 &&
      Date.now() - Number(data.at) < CACHE_TTL
    ) {
      return data.fonts;
    }
  } catch {
    // ignore
  }
  return null;
}

async function writeCache(fonts) {
  try {
    await fsp.mkdir(paths.cache, { recursive: true });
    await fsp.writeFile(
      CACHE_FILE,
      JSON.stringify({ at: Date.now(), fonts }),
      'utf8',
    );
  } catch {
    // ignore
  }
}

async function detectFonts() {
  let names = [];
  if (process.platform === 'win32') {
    try {
      names = await windowsFonts();
    } catch {
      names = [];
    }
  }
  if (names.length === 0) {
    try {
      names = await fontconfigFonts();
    } catch {
      names = [];
    }
  }
  const clean = cleanNames([...names, ...FALLBACK]);
  return clean.length ? clean : FALLBACK.slice().sort();
}

async function listFonts() {
  if (memory) return memory;
  if (pending) return pending;
  pending = (async () => {
    const cached = await readCache();
    if (cached) {
      memory = cleanNames([...cached, ...FALLBACK]);
      return memory;
    }
    const fonts = await detectFonts();
    memory = fonts;
    await writeCache(fonts);
    return memory;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

async function defaultFont() {
  const fonts = await listFonts();
  const lower = new Map(fonts.map((f) => [f.toLowerCase(), f]));
  for (const preferred of PREFERRED) {
    const hit = lower.get(preferred.toLowerCase());
    if (hit) return hit;
  }
  const firstReal = fonts.find(
    (f) => !['sans-serif', 'serif', 'monospace'].includes(f.toLowerCase()),
  );
  return firstReal || 'sans-serif';
}

module.exports = { listFonts, defaultFont, FALLBACK };
