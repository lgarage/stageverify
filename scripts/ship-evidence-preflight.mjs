#!/usr/bin/env node
/**
 * D-94 — Mechanical ship-evidence preflight (cheap; no model).
 *
 * HIGH class requires a valid security-gate-id and an allowlisted model: line.
 * Dropped tokens (do not require): sonnet-instruct, high-risk-adversarial,
 * sonnet-verify, solution-verifier, build-checker, ship-verifier.
 *
 * Usage:
 *   node scripts/ship-evidence-preflight.mjs --file path/to/report.txt
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
  console.log(`ship-evidence-preflight.mjs (D-94)
  --file <path>     Report text to scan
  --stdin           Read report from stdin
  --class <name>    tiny-fast-safe | default | high-risk | t2-prod-sensitive | medium | low
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
  "tiny-fast-safe": [],
  low: [],
  default: [],
  medium: [],
  "t2-prod-sensitive": [],
  "high-risk": ["security-gate-id", "model"],
};

const ALLOWED_MODELS = [
  "cursor-grok-4.6-high",
  "cursor-grok-4.6-xhigh",
  "claude-sonnet-5-thinking-high",
];

const VALID_GATE_ID =
  /security-gate-id:\s*[`"'*\s]*(?:bc-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const needed = REQUIRED[shipClass] || REQUIRED.default;
const missing = [];

for (const key of needed) {
  if (key === "security-gate-id") {
    if (/security-gate-id:\s*[`"'*\s]*not\s+run\b/i.test(body)) {
      missing.push("security-gate-id (NOT RUN rejected)");
      continue;
    }
    if (!VALID_GATE_ID.test(body)) {
      missing.push("security-gate-id");
    }
  } else if (key === "model") {
    if (!ALLOWED_MODELS.some((slug) => body.includes(`model: ${slug}`))) {
      missing.push(`model: <${ALLOWED_MODELS.join(" | ")}>`);
    }
  }
}

if (missing.length) {
  console.error("ship-evidence-preflight: FAIL");
  console.error("Missing or malformed:");
  for (const m of missing) console.error(`  - ${m}`);
  console.error("HIGH requires security-gate-id (UUID or bc-<uuid>) and an allowlisted model: line. Dropped D-60/D-65 tokens are not required.");
  process.exit(1);
}

console.log(`ship-evidence-preflight: PASS (class=${shipClass})`);
process.exit(0);
