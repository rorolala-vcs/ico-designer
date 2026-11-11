#!/usr/bin/env node
"use strict";

const { execFile } = require("child_process");
const { generate } = require("./lib/build");
const { createConfig, listConfigs, listCategories } = require("./lib/project");
const { startServer } = require("./server");

function printHelp() {
  console.log(`ico-designer — declarative icon designer

Usage:
  ico-designer editor [--port 5173] [--host 127.0.0.1] [--open]
  ico-designer generate [--force] [config...]
  ico-designer new [name]
  ico-designer list

Commands:
  editor      Start the visual editor (writes to configs/*.toml)
  generate    Incrementally render configs to artifact/*.png
  new         Create a config with the default look
  list        List configs and categories

Options:
  --force, -f   Regenerate even when inputs are unchanged
  --port, -p    Editor port (default 5173, falls forward when busy)
  --host        Editor host (default 127.0.0.1)
  --open        Open the editor in the default browser

Examples:
  npm run editor
  npm run generate
  node src/cli.js generate --force tree
`);
}

function parseArgs(argv) {
  const args = argv.slice();
  const flags = new Set();
  const values = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        values[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (["port", "host"].includes(arg.slice(2))) {
        values[arg.slice(2)] = args[++i];
      } else {
        flags.add(arg.slice(2));
      }
    } else if (arg === "-f") {
      flags.add("force");
    } else if (arg === "-p") {
      values.port = args[++i];
    } else if (arg === "-h") {
      flags.add("help");
    } else {
      positional.push(arg);
    }
  }
  return { flags, values, positional };
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], { windowsHide: true });
    } else if (process.platform === "darwin") {
      execFile("open", [url]);
    } else {
      execFile("xdg-open", [url]);
    }
  } catch {
    // not fatal
  }
}

async function nextName() {
  const existing = new Set((await listConfigs()).map((c) => c.name));
  for (let i = 0; i < 1000; i++) {
    const name = i === 0 ? "untitled" : `untitled-${i + 1}`;
    if (!existing.has(name)) return name;
  }
  throw new Error("Could not find an available config name");
}

async function main() {
  const { flags, values, positional } = parseArgs(process.argv.slice(2));
  let command = positional.shift();

  if (!command || flags.has("help") || command === "help") {
    printHelp();
    return;
  }
  if (command === "build") command = "generate";
  if (command === "serve" || command === "dev") command = "editor";

  if (command === "generate") {
    const names = positional.length ? positional : undefined;
    const { results, summary } = await generate({
      force: flags.has("force"),
      names,
    });
    console.log(
      `\n${summary.created} created · ${summary.updated} updated · ${summary.skipped} unchanged · ${summary.errors} failed`,
    );
    if (summary.errors > 0) {
      for (const r of results) {
        if (r.status === "error") console.error(`  ${r.name}: ${r.error}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  if (command === "new") {
    const name = positional[0] || (await nextName());
    const created = await createConfig(name);
    console.log(`Created configs/${created.name}.toml`);
    return;
  }

  if (command === "list") {
    const [configs, categories] = await Promise.all([
      listConfigs(),
      listCategories(),
    ]);
    console.log("Categories:");
    for (const c of categories) console.log(`  ${c.name}`);
    console.log("\nConfigs:");
    if (configs.length === 0) console.log("  (none)");
    for (const c of configs) {
      console.log(
        `  ${c.name.padEnd(20)} ${c.category || "?"}  ${c.size || "?"}px${
          c.error ? `  [${c.error}]` : ""
        }`,
      );
    }
    return;
  }

  if (command === "editor") {
    const port = values.port === undefined ? 5173 : Number(values.port);
    if (!Number.isFinite(port) || port < 0) {
      throw new Error("Invalid --port");
    }
    const { url } = await startServer({
      port,
      host: values.host || "127.0.0.1",
    });
    const [configs, categories] = await Promise.all([
      listConfigs(),
      listCategories(),
    ]);
    console.log(`ico-designer editor`);
    console.log(`  ${url}`);
    console.log(
      `  ${configs.length} config(s) · ${
        categories.map((c) => c.name).join(", ") || "no categories"
      }`,
    );
    console.log(`  Ctrl+C to stop`);
    if (flags.has("open")) openBrowser(url);
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
