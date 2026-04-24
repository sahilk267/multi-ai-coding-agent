#!/usr/bin/env node
// Print a compact, human-readable snapshot of the runtime configuration:
// routing matrix, fallback order, model limits, loop knobs, approval gates,
// host permissions and content-script matches.
//   node scripts/snapshot-config.mjs           # human report
//   node scripts/snapshot-config.mjs --json    # machine-readable
//
// Exits non-zero if config / manifest are obviously inconsistent (routing
// targets a disabled provider, an enabled provider has no host permission,
// fallback list references an unknown provider, etc.).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "..");
const cfg = JSON.parse(readFileSync(join(EXT, "config.json"), "utf8"));
const man = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));

const wantJSON = process.argv.includes("--json");
const issues = [];
const providers = Object.keys(cfg.providers || {});
const enabled = providers.filter((p) => cfg.providers[p].enabled);

// --- Consistency checks ---
for (const [kind, prov] of Object.entries(cfg.routing || {})) {
  if (!providers.includes(prov)) {
    issues.push(`routing.${kind} -> "${prov}" is not in providers`);
  } else if (!cfg.providers[prov].enabled) {
    issues.push(`routing.${kind} -> "${prov}" is disabled`);
  }
}
for (const p of cfg.fallbackOrder || []) {
  if (!providers.includes(p)) issues.push(`fallbackOrder references unknown provider "${p}"`);
}
for (const p of enabled) {
  if (!(p in (cfg.modelLimits || {}))) issues.push(`enabled provider "${p}" has no modelLimits entry`);
  const host = cfg.providers[p].url;
  try {
    const origin = new URL(host).origin + "/*";
    const ok = (man.host_permissions || []).some((h) => h === origin || h.startsWith(new URL(host).origin));
    if (!ok) issues.push(`provider "${p}" url ${host} is not covered by manifest.host_permissions`);
  } catch {
    issues.push(`provider "${p}" has invalid url: ${host}`);
  }
}
for (const url of [cfg.backendUrl, cfg.wsUrl]) {
  if (!url) continue;
  try {
    const origin = new URL(url).origin + "/*";
    const ok = (man.host_permissions || []).some((h) => h === origin);
    if (!ok) issues.push(`${url} is not covered by manifest.host_permissions (expected ${origin})`);
  } catch {
    issues.push(`invalid url in config: ${url}`);
  }
}

const snapshot = {
  manifest: {
    name: man.name,
    version: man.version,
    manifest_version: man.manifest_version,
    permissions: man.permissions || [],
    host_permissions: man.host_permissions || [],
    content_script_matches: (man.content_scripts || []).flatMap((c) => c.matches || []),
    service_worker: man.background?.service_worker,
    web_accessible_resources: (man.web_accessible_resources || []).flatMap((r) => r.resources || []).length,
  },
  backend: { url: cfg.backendUrl, ws: cfg.wsUrl },
  providers: Object.fromEntries(
    providers.map((p) => [p, { enabled: cfg.providers[p].enabled, url: cfg.providers[p].url, limit: cfg.modelLimits?.[p] ?? null }]),
  ),
  routing: cfg.routing || {},
  fallbackOrder: cfg.fallbackOrder || [],
  loop: cfg.loop || {},
  approval: cfg.approval || {},
  tokens: cfg.tokens || {},
  issues,
};

if (wantJSON) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  process.exit(issues.length ? 1 : 0);
}

const PAD = "  ";
console.log(`\n[manifest]  ${snapshot.manifest.name} v${snapshot.manifest.version} (MV${snapshot.manifest.manifest_version})`);
console.log(`${PAD}service worker:   ${snapshot.manifest.service_worker}`);
console.log(`${PAD}permissions:      ${snapshot.manifest.permissions.join(", ")}`);
console.log(`${PAD}host_permissions: (${snapshot.manifest.host_permissions.length})`);
for (const h of snapshot.manifest.host_permissions) console.log(`${PAD}${PAD}- ${h}`);
console.log(`${PAD}content scripts:  ${snapshot.manifest.content_script_matches.length} matches`);
for (const m of snapshot.manifest.content_script_matches) console.log(`${PAD}${PAD}- ${m}`);
console.log(`${PAD}web_accessible:   ${snapshot.manifest.web_accessible_resources} resources`);

console.log(`\n[backend]   REST=${snapshot.backend.url}   WS=${snapshot.backend.ws}`);

console.log(`\n[providers]`);
for (const [p, info] of Object.entries(snapshot.providers)) {
  const flag = info.enabled ? "ON " : "OFF";
  console.log(`${PAD}${flag}  ${p.padEnd(10)} limit=${String(info.limit).padStart(6)}  ${info.url}`);
}

console.log(`\n[routing]`);
for (const [k, v] of Object.entries(snapshot.routing)) {
  console.log(`${PAD}${k.padEnd(14)} -> ${v}`);
}
console.log(`${PAD}fallbackOrder: ${snapshot.fallbackOrder.join(" -> ")}`);

console.log(`\n[loop]      ${JSON.stringify(snapshot.loop)}`);
console.log(`[approval]  ${JSON.stringify(snapshot.approval)}`);
console.log(`[tokens]    ${JSON.stringify(snapshot.tokens)}`);

if (issues.length) {
  console.log(`\n[issues] (${issues.length})`);
  for (const i of issues) console.log(`${PAD}- ${i}`);
} else {
  console.log(`\n[issues] none`);
}
console.log(`\nStatus: ${issues.length ? "FAIL" : "OK"}.`);
process.exit(issues.length ? 1 : 0);
