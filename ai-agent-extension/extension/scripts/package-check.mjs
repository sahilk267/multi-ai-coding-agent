#!/usr/bin/env node
// Release smoke test: build the extension zip the same way `npm run package`
// does, verify the zip's integrity, extract it to a temp dir, and run the
// full load-check against the extracted contents. This proves the
// distributable artifact is loadable, not just the working tree.
//
//   node scripts/package-check.mjs
//   node scripts/package-check.mjs --keep   # don't delete the temp zip/dir
//
// Skips cleanly (exit 0) if `zip` or `unzip` is not on PATH — that's a
// release-machine prerequisite, not a dev-machine one.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(HERE, "..");
const KEEP = process.argv.includes("--keep");

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const zipBin = which("zip");
const unzipBin = which("unzip");

if (!zipBin || !unzipBin) {
  console.log(
    `package-check skipped: ${!zipBin ? "'zip'" : "'unzip'"} not on PATH ` +
      "(install zip/unzip to enable this release smoke test).",
  );
  process.exit(0);
}

const workdir = mkdtempSync(join(tmpdir(), "ai-agent-pkg-"));
const zipPath = join(workdir, "ai-agent-extension.zip");
const extractDir = join(workdir, "extracted");

function cleanup() {
  if (KEEP) {
    console.log(`(--keep set) artifacts left in ${workdir}`);
    return;
  }
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch (e) {
    console.log(`cleanup warning: ${e.message}`);
  }
}

function fail(msg) {
  console.error(`X ${msg}`);
  cleanup();
  process.exit(1);
}

// 1) build the zip — mirrors the `npm run package` recipe exactly
console.log(`>>> zipping ${EXT_DIR} -> ${zipPath}`);
const zipRes = spawnSync(
  zipBin,
  ["-rq", zipPath, ".", "-x", "node_modules/*", "*.zip"],
  { cwd: EXT_DIR, encoding: "utf8" },
);
if (zipRes.status !== 0) fail(`zip failed: ${zipRes.stderr || zipRes.stdout}`);
if (!existsSync(zipPath)) fail("zip reported success but file is missing");
const sizeKB = Math.round(statSync(zipPath).size / 1024);
console.log(`    zip size: ${sizeKB} KB`);

// 2) integrity test
console.log(">>> unzip -t (integrity)");
const tRes = spawnSync(unzipBin, ["-tq", zipPath], { encoding: "utf8" });
if (tRes.status !== 0) fail(`zip integrity check failed: ${tRes.stderr || tRes.stdout}`);

// 3) extract and count files
console.log(`>>> extracting -> ${extractDir}`);
const xRes = spawnSync(unzipBin, ["-q", zipPath, "-d", extractDir], {
  encoding: "utf8",
});
if (xRes.status !== 0) fail(`extract failed: ${xRes.stderr || xRes.stdout}`);

// 4) run load-check against the extracted tree
console.log(">>> running load-check against extracted contents");
const lcRes = spawnSync(
  process.execPath,
  [join(HERE, "load-check.mjs"), "--root", extractDir],
  { encoding: "utf8" },
);
process.stdout.write(lcRes.stdout || "");
if (lcRes.stderr) process.stderr.write(lcRes.stderr);
if (lcRes.status !== 0) fail("load-check failed against the packaged zip");

console.log(`\nPackage smoke: OK (${sizeKB} KB).`);
cleanup();
process.exit(0);
