#!/usr/bin/env node
// Sanity-check what a provider will actually receive after budgeting.
//   node scripts/budget.mjs <provider> <file> [--reserved=1024] [--head=0.6] [--quiet]
// Prints a JSON report to stderr and the budgeted prompt to stdout.
import { readFileSync } from "node:fs";
import { budgetPrompt, MODEL_LIMITS } from "../core/tokenManager.js";

const argv = process.argv.slice(2);
const wantsHelp = argv.includes("-h") || argv.includes("--help");
if (wantsHelp || argv.length < 2) {
  console.error(
    `Usage: node scripts/budget.mjs <provider> <file|-> [--reserved=N] [--head=R] [--quiet]\n` +
      `Providers: ${Object.keys(MODEL_LIMITS).join(", ")}`,
  );
  process.exit(wantsHelp ? 0 : 2);
}

const [provider, file, ...rest] = argv;
const opts = { reserved: 1024, headRatio: 0.6 };
let quiet = false;
for (const a of rest) {
  if (a === "--quiet") quiet = true;
  else if (a.startsWith("--reserved=")) opts.reserved = Number(a.slice(11));
  else if (a.startsWith("--head=")) opts.headRatio = Number(a.slice(7));
  else {
    console.error(`unknown arg: ${a}`);
    process.exit(2);
  }
}

if (!(provider in MODEL_LIMITS)) {
  console.error(
    `unknown provider "${provider}". Known: ${Object.keys(MODEL_LIMITS).join(", ")}`,
  );
  process.exit(2);
}

let text;
try {
  text = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}

const r = budgetPrompt(text, provider, opts);
const report = {
  provider,
  file,
  modelLimit: MODEL_LIMITS[provider],
  reservedReply: opts.reserved,
  budget: r.budget,
  originalTokens: Math.ceil(text.length / 4),
  finalTokens: r.tokens,
  droppedTokens: r.dropped,
  truncated: r.truncated,
  headRatio: opts.headRatio,
};
console.error(JSON.stringify(report, null, 2));
if (!quiet) process.stdout.write(r.prompt);
process.exit(0);
