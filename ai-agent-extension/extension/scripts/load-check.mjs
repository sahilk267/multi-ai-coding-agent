#!/usr/bin/env node
// Static "would Chrome load this extension?" check.
// Validates manifest.json shape and that every file the manifest references
// actually exists on disk. Catches typos before you reload chrome://extensions.
//
//   node scripts/load-check.mjs            # human report
//   node scripts/load-check.mjs --json     # machine-readable
//
// Exits non-zero on any missing file, malformed JSON, or required-key gap.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const wantJSON = argv.includes("--json");
const rootIdx = argv.indexOf("--root");
const ROOT = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, "..");

const errors = [];
const warnings = [];
const checked = [];

function fileMustExist(rel, label) {
  const abs = join(ROOT, rel);
  checked.push(rel);
  if (!existsSync(abs)) errors.push(`${label}: missing file '${rel}'`);
}

function readJSON(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    errors.push(`missing file '${rel}'`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    errors.push(`invalid JSON in '${rel}': ${e.message}`);
    return null;
  }
}

// 1) manifest.json
const manifest = readJSON("manifest.json");
if (manifest) {
  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version must be 3, got ${manifest.manifest_version}`);
  }
  for (const k of ["name", "version", "description", "permissions", "host_permissions"]) {
    if (!(k in manifest)) errors.push(`manifest missing required key '${k}'`);
  }

  // background service worker
  const sw = manifest.background?.service_worker;
  if (!sw) errors.push("manifest.background.service_worker not set");
  else fileMustExist(sw, "background");

  // popup
  const popup = manifest.action?.default_popup;
  if (popup) fileMustExist(popup, "action.default_popup");

  // content scripts
  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) fileMustExist(js, "content_scripts.js");
  }

  // web-accessible resources — skip glob patterns (ui/*, icons/*)
  for (const block of manifest.web_accessible_resources || []) {
    for (const res of block.resources || []) {
      if (res.includes("*")) {
        // glob — just verify the directory prefix exists
        const dir = res.split("/").slice(0, -1).join("/");
        if (dir) {
          const { existsSync: _ex } = await import("node:fs");
          const { join: _join } = await import("node:path");
          if (!_ex(_join(ROOT, dir))) {
            errors.push(`web_accessible_resources: glob prefix dir '${dir}/' not found`);
          }
        }
        continue;
      }
      fileMustExist(res, "web_accessible_resources");
    }
  }

  // host permissions sanity — must cover all 4 providers
  const REQUIRED_HOSTS = [
    "chatgpt.com",
    "deepseek.com",
    "gemini.google.com",
    "qwen.ai",
  ];
  const hostStr = (manifest.host_permissions || []).join(" ");
  for (const h of REQUIRED_HOSTS) {
    if (!hostStr.includes(h)) {
      warnings.push(`host_permissions does not mention '${h}' — provider may not load`);
    }
  }
}

// 2) config.json — required keys for routing
const config = readJSON("config.json");
if (config) {
  for (const k of ["backendUrl", "wsUrl", "routing", "modelLimits", "providers", "fallbackOrder"]) {
    if (!(k in config)) errors.push(`config.json missing required key '${k}'`);
  }
  const REQUIRED_TASKS = ["planning", "coding", "debugging", "long_context"];
  const REQUIRED_PROVIDERS = ["chatgpt", "deepseek", "qwen", "gemini"];
  for (const t of REQUIRED_TASKS) {
    const primary = config.routing?.[t];
    if (!primary) {
      errors.push(`config.routing.${t} not set`);
    } else if (!REQUIRED_PROVIDERS.includes(primary)) {
      errors.push(`config.routing.${t} = '${primary}' is not a known provider`);
    }
  }
  for (const p of REQUIRED_PROVIDERS) {
    if (!config.modelLimits?.[p]) {
      warnings.push(`config.modelLimits.${p} not set — token budgeter will use default`);
    }
    const prov = config.providers?.[p];
    if (!prov?.url) {
      errors.push(`config.providers.${p}.url not set`);
    }
    if (prov && prov.enabled === false) {
      warnings.push(`config.providers.${p}.enabled = false (provider disabled)`);
    }
  }
  if (Array.isArray(config.fallbackOrder)) {
    for (const p of config.fallbackOrder) {
      if (!REQUIRED_PROVIDERS.includes(p)) {
        errors.push(`config.fallbackOrder contains unknown provider '${p}'`);
      }
    }
  }
}

// 3) all 4 adapter files present (defensive — manifest already lists them, but
//    a missing adapter is a structural error worth calling out separately)
for (const p of ["chatgpt", "deepseek", "qwen", "gemini"]) {
  fileMustExist(`adapters/${p}.js`, `adapter:${p}`);
}
fileMustExist("adapters/baseAdapter.js", "adapter:base");

const ok = errors.length === 0;

if (wantJSON) {
  process.stdout.write(
    JSON.stringify({ ok, errors, warnings, filesChecked: checked.length }, null, 2) + "\n",
  );
  process.exit(ok ? 0 : 1);
}

console.log(`Files checked: ${checked.length}`);
if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) console.log(`  X ${e}`);
}
console.log(`\nLoad check: ${ok ? "OK" : "FAIL"}.`);
process.exit(ok ? 0 : 1);
