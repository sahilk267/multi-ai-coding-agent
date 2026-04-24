#!/usr/bin/env node
// Audit the DOM selectors each provider adapter currently advertises.
// Useful after a ChatGPT/DeepSeek/Qwen/Gemini UI change: run this and
// compare counts / entries against the live DOM (devtools).
//
//   node scripts/check-selectors.mjs            # human report
//   node scripts/check-selectors.mjs --json     # machine-readable
//   node scripts/check-selectors.mjs --provider chatgpt
//
// Exits non-zero if any expected selector group is empty (regression guard).
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = join(HERE, "..", "adapters");
const REQUIRED_GROUPS = [
  "input",
  "sendButton",
  "responseContainer",
  "lastResponse",
  "spinner",
  "loginIndicator",
];

const argv = process.argv.slice(2);
const wantJSON = argv.includes("--json");
const onlyIdx = argv.indexOf("--provider");
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

// Stub utils — adapters call utils.findFirst() in methods, but only the
// constructor runs while we collect selectors.
const stubUtils = {
  findFirst: () => null,
  findAll: () => [],
  sleep: () => Promise.resolve(),
  log: () => {},
};

const files = readdirSync(ADAPTER_DIR)
  .filter((f) => f.endsWith(".js") && f !== "baseAdapter.js")
  .sort();

const report = [];
let hardFail = false;

for (const file of files) {
  const provider = file.replace(/\.js$/, "");
  if (only && provider !== only) continue;
  const url = pathToFileURL(join(ADAPTER_DIR, file)).href;
  let mod;
  try {
    mod = await import(url);
  } catch (e) {
    report.push({ provider, error: `import failed: ${e.message}` });
    hardFail = true;
    continue;
  }
  const Cls = mod.default;
  if (typeof Cls !== "function") {
    report.push({ provider, error: "no default export class" });
    hardFail = true;
    continue;
  }
  let inst;
  try {
    inst = new Cls(stubUtils);
  } catch (e) {
    report.push({ provider, error: `construct failed: ${e.message}` });
    hardFail = true;
    continue;
  }
  const selectors = inst.selectors || {};
  const groups = {};
  const missing = [];
  const empty = [];
  for (const g of REQUIRED_GROUPS) {
    const arr = selectors[g];
    if (!Array.isArray(arr)) {
      missing.push(g);
      groups[g] = null;
    } else {
      groups[g] = arr;
      if (arr.length === 0) empty.push(g);
    }
  }
  // Any extras beyond the required set (captcha, rateLimit, etc.)
  for (const k of Object.keys(selectors)) {
    if (!(k in groups)) groups[k] = selectors[k];
  }
  if (missing.length || empty.length) hardFail = true;
  report.push({
    provider,
    name: inst.name || provider,
    groups,
    missing,
    empty,
  });
}

if (wantJSON) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(hardFail ? 1 : 0);
}

const PAD = "  ";
for (const r of report) {
  if (r.error) {
    console.log(`\n[${r.provider}] ERROR: ${r.error}`);
    continue;
  }
  console.log(`\n[${r.name}]  (${r.provider}.js)`);
  for (const [g, arr] of Object.entries(r.groups)) {
    if (arr === null) {
      console.log(`${PAD}${g}: MISSING`);
      continue;
    }
    const tag = arr.length === 0 ? " EMPTY" : ` (${arr.length})`;
    console.log(`${PAD}${g}:${tag}`);
    for (const sel of arr) console.log(`${PAD}${PAD}- ${sel}`);
  }
  if (r.missing.length) console.log(`${PAD}!! missing groups: ${r.missing.join(", ")}`);
  if (r.empty.length) console.log(`${PAD}!! empty groups:   ${r.empty.join(", ")}`);
}

console.log(
  `\nProviders audited: ${report.length}. Status: ${hardFail ? "FAIL" : "OK"}.`,
);
process.exit(hardFail ? 1 : 0);
