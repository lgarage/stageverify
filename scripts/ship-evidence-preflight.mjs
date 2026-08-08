#!/usr/bin/env node
/**
 * D-65 — Mechanical ship-evidence preflight (cheap; no model).
 *
 * Confirms required evidence tokens exist in stdin or --file before dispatching
 * Grok Ship Verifier. Fail here → fix evidence formatting without a Ship Task
 * (does NOT count as Ship FAIL toward D-54/D-55).
 *
 * Usage:
 *   node scripts/ship-evidence-preflight.mjs --file path/to/report.txt
 *   node scripts/ship-evidence-preflight.mjs --stdin < report.txt
 *   node scripts/ship-evidence-preflight.mjs --class tiny-fast-safe --file …
 *   node scripts/ship-evidence-preflight.mjs --class high-risk --file …
 *
 * Exit 0 = PASS; exit 1 = FAIL (missing tokens).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    stdin: { type: "boolean", default: false },
    class: { type: "string", default: "default" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`ship-evidence-preflight.mjs (D-65)
  --file <path>     Report text to scan
  --stdin           Read report from stdin
  --class <name>    tiny-fast-safe | default | high-risk | t2-prod-sensitive
`);
  process.exit(0);
}

function readBody() {
  if (values.file) return readFileSync(values.file, "utf8");
  if (values.stdin || !process.stdin.isTTY) {
    return readFileSync(0, "utf8");
  }
  console.error("ERROR: provide --file or --stdin");
  process.exit(2);
}

const body = readBody();
const shipClass = values.class || "default";

/** @type {Record<string, string[]>} */
const REQUIRED = {
  "tiny-fast-safe": [
    "ui-before-after:", // or N/A — checked loosely below
  ],
  default: [
    "ship-verifier:", // may be N/A after this preflight for tiny — still require intent line in report
  ],
  "t2-prod-sensitive": ["ship-verifier:", "build-checker:"],
  "high-risk": [
    "sonnet-instruct:",
    "sonnet-verify:",
    "security-gate-id",
    "ship-verifier:",
  ],
};

const patterns = {
  "ui-before-after:": /ui-before-after:\s*\S+/i,
  "ship-verifier:": /ship-verifier:\s*\S+/i,
  "build-checker:": /build-checker:\s*\S+/i,
  "sonnet-instruct:": /sonnet-instruct:\s*\S+/i,
  "sonnet-verify:": /sonnet-verify:\s*\S+/i,
  "security-gate-id": /security-gate-id:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  "model:": /model:\s*\S+/i,
};

const needed = REQUIRED[shipClass] || REQUIRED.default;
const missing = [];

for (const key of needed) {
  const re = patterns[key];
  if (!re) continue;
  if (!re.test(body)) missing.push(key);
}

// High-risk also needs model line near security gate
if (shipClass === "high-risk" && /security-gate-id:/i.test(body) && !/model:\s*claude-sonnet-5-thinking-high/i.test(body)) {
  missing.push("model: claude-sonnet-5-thinking-high (near security gate)");
}

// UUID-shaped gate id when security-gate-id present
if (/security-gate-id:/i.test(body) && !patterns["security-gate-id"].test(body)) {
  if (!missing.includes("security-gate-id")) missing.push("security-gate-id (UUID format)");
}

if (missing.length) {
  console.error("ship-evidence-preflight: FAIL");
  console.error("Missing or malformed:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error("Fix evidence in the completion report, then re-run preflight.");
  console.error("Do NOT dispatch Ship Verifier yet (D-65 — preflight fail ≠ Ship FAIL).");
  process.exit(1);
}

console.log(`ship-evidence-preflight: PASS (class=${shipClass})`);
process.exit(0);
