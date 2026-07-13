#!/usr/bin/env node
/**
 * Verifier verdict logger + stats for Harness V1 Freeze calibration.
 *
 * Purpose: evidence stream for Harness V1 Freeze decisions (which verifier roles earn tokens).
 * Caveat: concurrent sessions appending may merge-conflict; append-only JSONL keeps conflicts
 * trivial (union merge) but is not conflict-free.
 *
 * Append: npm run verifier:log -- --role <role> --verdict <verdict> --task-id <id> [--real yes|no|na] [--model <slug>] [--note "..."]
 * Stats:  npm run verifier:stats
 *
 * --real labels whether a FINDING was real vs noise — it applies only to non-PASS verdicts
 * (PARTIAL, FAIL, MEDIUM, HIGH): yes = real finding, no = noise. PASS rows should use na;
 * PASS rows labeled yes|no are reported as "mislabeled PASS rows" in stats (informational).
 *
 * Dedupe: last-write-wins on (taskId, role) — a correction row must re-supply the full row.
 */
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "PROJECT_STATUS", "verifier-log.jsonl");

const ROLES = new Set(["ship", "repair", "planning", "qa", "stall", "critical", "security", "work"]);
const VERDICTS = new Set(["PASS", "PARTIAL", "FAIL", "MEDIUM", "HIGH", "NOT_RUN"]);
const REAL_VALUES = new Set(["yes", "no", "na"]);
const SECURITY_ONLY_VERDICTS = new Set(["MEDIUM", "HIGH"]);
const FINDING_VERDICTS = new Set(["PARTIAL", "FAIL", "MEDIUM", "HIGH"]);

const USAGE = `Usage:
  node scripts/verifier-log.mjs --role <ship|repair|planning|qa|stall|critical|security|work> --verdict <PASS|PARTIAL|FAIL|MEDIUM|HIGH|NOT_RUN|NOT RUN> --task-id <id> [--real yes|no|na] [--model <slug>] [--note "..."]
  node scripts/verifier-log.mjs --stats`;

/**
 * kebab-case → camelCase (task-id → taskId).
 * @param {string} key
 */
function camelizeKey(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
export function parseKvArgs(args) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--stats") {
      out.stats = "true";
      continue;
    }
    if (arg.startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--")) {
      out[camelizeKey(arg.slice(2))] = args[++i];
    } else if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      out[camelizeKey(arg.slice(2, eq))] = arg.slice(eq + 1);
    }
  }
  return out;
}

/**
 * @returns {import('node:fs').PathLike}
 */
export function getLogPath() {
  return LOG_PATH;
}

/**
 * @returns {Array<Record<string, string>>}
 */
export function readLogRows() {
  if (!existsSync(LOG_PATH)) {
    return [];
  }
  const raw = readFileSync(LOG_PATH, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return /** @type {Record<string, string>} */ (JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((row) => row != null);
}

/**
 * Last-write-wins dedupe on (taskId, role).
 * @param {Array<Record<string, string>>} rows
 */
export function dedupeRows(rows) {
  /** @type {Map<string, Record<string, string>>} */
  const map = new Map();
  for (const row of rows) {
    const key = `${row.taskId}\0${row.role}`;
    map.set(key, row);
  }
  return [...map.values()];
}

/**
 * @param {Record<string, string>} opts
 */
export function appendRow(opts) {
  const role = opts.role;
  let verdict = opts.verdict;
  const taskId = opts.taskId;
  const real = opts.real ?? "na";
  const model = opts.model ?? "";
  const note = opts.note ?? "";

  if (!role || !ROLES.has(role)) {
    console.error(`Invalid --role: ${role ?? "(missing)"}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (!verdict) {
    console.error("Missing --verdict");
    console.error(USAGE);
    process.exit(1);
  }

  if (verdict === "NOT RUN") {
    verdict = "NOT_RUN";
  }
  if (!VERDICTS.has(verdict)) {
    console.error(`Invalid --verdict: ${verdict}`);
    console.error(USAGE);
    process.exit(1);
  }

  if (SECURITY_ONLY_VERDICTS.has(verdict) && role !== "security") {
    console.error(`Verdict ${verdict} is valid only for role=security`);
    console.error(USAGE);
    process.exit(1);
  }

  if (!taskId) {
    console.error("Missing --task-id");
    console.error(USAGE);
    process.exit(1);
  }

  if (!REAL_VALUES.has(real)) {
    console.error(`Invalid --real: ${real}`);
    console.error(USAGE);
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const row = { date, role, verdict, taskId, model, real, note };
  appendFileSync(LOG_PATH, `${JSON.stringify(row)}\n`, "utf8");
  console.log(`appended: ${JSON.stringify(row)}`);
}

/**
 * Pure stats computation over deduped rows.
 * Findings = non-PASS verdicts (PARTIAL/FAIL/MEDIUM/HIGH); --real applies to findings only.
 * Finding precision = real=yes / (real=yes + real=no) over labeled findings.
 * @param {Array<Record<string, string>>} rows
 * @returns {{
 *   perRole: Record<string, number>,
 *   perVerdict: Record<string, number>,
 *   notRunCount: number,
 *   labeledReal: number,
 *   labeledNoise: number,
 *   unlabeledFindings: number,
 *   mislabeledPassRows: number,
 *   findingPrecision: number | null,
 * }}
 */
export function computeStats(rows) {
  /** @type {Record<string, number>} */
  const perRole = {};
  /** @type {Record<string, number>} */
  const perVerdict = {};
  let notRunCount = 0;
  let labeledReal = 0;
  let labeledNoise = 0;
  let unlabeledFindings = 0;
  let mislabeledPassRows = 0;

  for (const row of rows) {
    perRole[row.role] = (perRole[row.role] ?? 0) + 1;
    perVerdict[row.verdict] = (perVerdict[row.verdict] ?? 0) + 1;
    if (row.verdict === "NOT_RUN") {
      notRunCount++;
    }

    if (FINDING_VERDICTS.has(row.verdict)) {
      if (row.real === "yes") {
        labeledReal++;
      } else if (row.real === "no") {
        labeledNoise++;
      } else {
        unlabeledFindings++;
      }
    } else if (row.verdict === "PASS" && (row.real === "yes" || row.real === "no")) {
      mislabeledPassRows++;
    }
  }

  const labeledFindings = labeledReal + labeledNoise;
  const findingPrecision = labeledFindings > 0 ? labeledReal / labeledFindings : null;

  return {
    perRole,
    perVerdict,
    notRunCount,
    labeledReal,
    labeledNoise,
    unlabeledFindings,
    mislabeledPassRows,
    findingPrecision,
  };
}

export function printStats() {
  const stats = computeStats(dedupeRows(readLogRows()));

  console.log("verifier-log stats (deduped by taskId+role, last-write-wins)");
  console.log("");
  console.log("Per-role counts:");
  for (const [role, count] of Object.entries(stats.perRole).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${role}: ${count}`);
  }
  console.log("");
  console.log("Verdict distribution:");
  for (const [verdict, count] of Object.entries(stats.perVerdict).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(`  ${verdict}: ${count}`);
  }
  console.log("");
  console.log(`NOT_RUN count: ${stats.notRunCount}`);
  console.log(`Labeled findings real=yes: ${stats.labeledReal}`);
  console.log(`Labeled findings real=no (noise): ${stats.labeledNoise}`);
  console.log(`Unlabeled findings (real=na): ${stats.unlabeledFindings}`);
  const labeledFindings = stats.labeledReal + stats.labeledNoise;
  const precision =
    stats.findingPrecision != null ? `${(stats.findingPrecision * 100).toFixed(1)}%` : "n/a";
  console.log(
    `Finding precision (labeled non-PASS rows): ${precision} (${stats.labeledReal}/${labeledFindings})`,
  );
  if (stats.mislabeledPassRows > 0) {
    console.log(
      `WARN: mislabeled PASS rows (real=yes|no on PASS — should be na): ${stats.mislabeledPassRows}`,
    );
  }
}

function main() {
  const opts = parseKvArgs(process.argv.slice(2));

  if (opts.stats === "true") {
    printStats();
    return;
  }

  appendRow(opts);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
