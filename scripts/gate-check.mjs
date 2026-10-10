#!/usr/bin/env node
/**
 * PR evidence gate checker — mechanical presence-only verification for HIGH-tier diffs (D-94).
 *
 * HIGH (security-gate-id required): firestore.rules; auth/PIN/roles; core-loop write CFs
 * (invoice approve, spot assign/reassign, vendor drop-off, tech pickup, spot release);
 * billing; CI/gate config (.github/workflows, firebase.json, gate-check, install-git-hooks,
 * root package.json scripts / firebase major).
 *
 * Other functions/ and backend files are MEDIUM — no security-gate-id.
 * UI / copy / docs are LOW — no security-gate-id.
 *
 * src/** auth heuristic (/auth|session|token|guard|login|pin|role/i) is approximate fail-up.
 *
 * The check does not validate verdict PASS/HIGH — presence-only by design (D-28).
 * The **security-gate-id value** must be a lowercase UUID or `bc-<uuid>`; `NOT RUN`,
 * empty, and junk id values fail.
 *
 * Model line (D-38): if present, must match ALLOWED_GATE_MODELS. Missing model does
 * **not** fail mechanical CI when the id is valid (optional warning only).
 *
 * Self-bypass caveat: a fork PR can modify gate-check.mjs itself to neuter the check on
 * the merge ref — this gate is advisory-vs-malice; branch protection + human review
 * remain the backstop for hostile PRs. No GATE_SKIP in this script.
 *
 * Run: npm run gate:check [-- --base <ref> --head <ref> --pr-body-file <path> | --evidence-from-commits]
 * Evidence priority: env GATE_PR_BODY > --pr-body-file > --evidence-from-commits > empty.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Matches label + optional wrap punctuation + bare or bc- prefixed lowercase UUID. */
export const SECURITY_GATE_ID_RE =
  /security-gate-id:\s*[`"'*\s]*(?:bc-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const VALID_GATE_ID_VALUE_RE =
  /^(?:bc-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const MISSING_SECURITY_GATE_ID_HINT =
  "security-gate-id: <lowercase-hex UUID 8-4-4-4-12 or bc-<uuid>>";

/**
 * @param {string} prBody
 * @returns {string | null} first token after security-gate-id: or null
 */
export function extractSecurityGateIdValue(prBody) {
  const labelIdx = prBody.search(/security-gate-id:/i);
  if (labelIdx === -1) {
    return null;
  }
  let rest = prBody.slice(labelIdx);
  const colonMatch = rest.match(/^security-gate-id:\s*/i);
  if (!colonMatch) {
    return null;
  }
  rest = rest.slice(colonMatch[0].length).replace(/^[`"'*\s]+/, "");
  const tokenMatch = rest.match(/^([^\s·|,;]+)/);
  if (!tokenMatch) {
    return null;
  }
  return tokenMatch[1].replace(/^[`"'*]+|[`"'*]+$/g, "") || null;
}

/**
 * @param {string} prBody
 * @returns {boolean}
 */
export function hasValidSecurityGateId(prBody) {
  const labelIdx = prBody.search(/security-gate-id:/i);
  if (labelIdx === -1) {
    return false;
  }
  const afterColon = prBody.slice(labelIdx).replace(/^security-gate-id:\s*/i, "");
  if (/^[`"'*\s]*not\s+run\b/i.test(afterColon)) {
    return false;
  }
  const value = extractSecurityGateIdValue(prBody);
  if (!value) {
    return false;
  }
  return VALID_GATE_ID_VALUE_RE.test(value);
}

/** Preference order (D-38 amend 2026-08-08): Sonnet 5 primary — Sonnet 4.6 retired from active gates. */
export const ALLOWED_GATE_MODELS = [
  "claude-sonnet-5-thinking-high",
];

/** @deprecated Use ALLOWED_GATE_MODELS — kept for tests referencing primary slug */
export const REQUIRED_MODEL_LINE = `model: ${ALLOWED_GATE_MODELS[0]}`;

export const MISSING_MODEL_LINE_HINT = `model: <allowlisted slug per D-38 (${ALLOWED_GATE_MODELS.join(" | ")})>`;

/**
 * @param {string} prBody
 * @returns {boolean}
 */
export function hasAllowedGateModel(prBody) {
  return ALLOWED_GATE_MODELS.some((slug) => prBody.includes(`model: ${slug}`));
}

const AUTH_HEURISTIC = /auth|session|token|guard|login|pin|role/i;

/** Core-loop write Cloud Functions — HIGH (D-94). Not all of functions/. */
export const HIGH_CORE_LOOP_CF_RE =
  /(?:^|\/)(?:approveVendorInvoiceImport|assignVendorStagingLocation|reassignDeliveryStagingLocation|markVendorDelivered|markVendorDeliveriesBulk|recordPickupEvent|releasePlannedStagingLocation|approveIdempotentReplay)(?:\.|$)/i;

export const HIGH_GATE_CONFIG_RE =
  /^(?:\.github\/workflows\/|firebase\.json$|scripts\/gate-check\.mjs$|scripts\/install-git-hooks\.mjs$|scripts\/ship-evidence-preflight\.mjs$)/;

/**
 * @param {string} filePath
 * @returns {string[]}
 */
export function classifyPath(filePath) {
  const p = filePath.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  /** @type {string[]} */
  const tags = [];

  if (
    p.startsWith("docs/") ||
    p.startsWith("PROJECT_STATUS/") ||
    p.startsWith(".cursor/") ||
    p.startsWith("functions/lib/") ||
    p === "AGENTS.md" ||
    /^README/i.test(p)
  ) {
    tags.push("excluded");
  }

  if (p === "firestore.rules") {
    tags.push("high-risk");
  }
  if (HIGH_GATE_CONFIG_RE.test(p)) {
    tags.push("high-risk");
  }
  if (p.startsWith("src/") && AUTH_HEURISTIC.test(p)) {
    tags.push("high-risk");
  }
  if (p.startsWith("functions/") && !p.startsWith("functions/lib/")) {
    const base = p.split("/").pop() ?? p;
    if (HIGH_CORE_LOOP_CF_RE.test(base) || AUTH_HEURISTIC.test(base) || /billing/i.test(p)) {
      tags.push("high-risk");
    }
  }
  if (/billing/i.test(p) && (p.startsWith("src/") || p.startsWith("functions/"))) {
    if (!tags.includes("high-risk")) tags.push("high-risk");
  }

  if (p.startsWith("src/")) {
    tags.push("substantive-ship");
  }
  if (p.startsWith("public/")) {
    tags.push("substantive-ship");
  }
  if (p === "index.html") {
    tags.push("substantive-ship");
  }
  if (p.startsWith("functions/src/")) {
    tags.push("substantive-ship");
  }
  if (p.startsWith("scripts/") && p.endsWith(".mjs") && !p.endsWith(".test.mjs")) {
    tags.push("substantive-ship");
  }

  return tags;
}

/**
 * @param {string | undefined} version
 * @returns {number | null}
 */
function parseMajorVersion(version) {
  if (typeof version !== "string" || !version) {
    return null;
  }
  const stripped = version.replace(/^[\^~>=<]+/, "");
  const match = stripped.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} baseJson
 * @param {Record<string, unknown> | null | undefined} headJson
 * @returns {boolean}
 */
export function packageJsonHighRisk(baseJson, headJson) {
  if (!baseJson || !headJson) {
    return false;
  }

  const baseScripts = JSON.stringify(baseJson.scripts ?? {});
  const headScripts = JSON.stringify(headJson.scripts ?? {});
  if (baseScripts !== headScripts) {
    return true;
  }

  for (const depKey of ["dependencies", "devDependencies"]) {
    const baseDeps = /** @type {Record<string, string> | undefined} */ (baseJson[depKey]);
    const headDeps = /** @type {Record<string, string> | undefined} */ (headJson[depKey]);
    const baseFirebase = baseDeps?.firebase;
    const headFirebase = headDeps?.firebase;
    if (baseFirebase && headFirebase) {
      const baseMajor = parseMajorVersion(baseFirebase);
      const headMajor = parseMajorVersion(headFirebase);
      if (baseMajor !== null && headMajor !== null && baseMajor !== headMajor) {
        return true;
      }
    }
  }

  return false;
}

/**
 * @param {string} prBody
 * @param {boolean} hasHighRisk
 * @returns {{ pass: boolean, missing: string[], warnings: string[] }}
 */
export function checkEvidence(prBody, hasHighRisk) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const warnings = [];

  if (!hasHighRisk) {
    return { pass: true, missing, warnings };
  }

  if (!hasValidSecurityGateId(prBody)) {
    missing.push(MISSING_SECURITY_GATE_ID_HINT);
  } else if (!hasAllowedGateModel(prBody)) {
    warnings.push(`optional: ${MISSING_MODEL_LINE_HINT}`);
  }
  if (!/actual model invocation evidence:/i.test(prBody)) {
    warnings.push("actual model invocation evidence: line absent");
  }

  return { pass: missing.length === 0, missing, warnings };
}

/**
 * @param {string} ref
 * @returns {Record<string, unknown> | null}
 */
function readPackageJsonAtRef(ref) {
  try {
    const raw = execFileSync("git", ["show", `${ref}:package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return /** @type {Record<string, unknown>} */ (JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * @param {string} base
 * @param {string} head
 * @returns {string[] | null} null when no diff range can be resolved (fail-up in caller)
 */
function getChangedFiles(base, head) {
  /** @param {string} range */
  const diff = (range) =>
    execFileSync("git", ["diff", "--name-only", range], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  let out;
  try {
    out = diff(`${base}...${head}`);
  } catch {
    console.log(`WARN: diff ${base}...${head} failed — falling back to origin/main...${head}`);
    try {
      out = diff(`origin/main...${head}`);
    } catch {
      return null;
    }
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} args
 * @returns {{ base: string, head: string, prBodyFile: string | null, evidenceFromCommits: boolean }}
 */
function parseArgs(args) {
  let base = "origin/main";
  let head = "HEAD";
  /** @type {string | null} */
  let prBodyFile = null;
  let evidenceFromCommits = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base" && args[i + 1]) {
      base = args[++i];
    } else if (arg === "--head" && args[i + 1]) {
      head = args[++i];
    } else if (arg === "--pr-body-file" && args[i + 1]) {
      prBodyFile = args[++i];
    } else if (arg === "--evidence-from-commits") {
      evidenceFromCommits = true;
    }
  }

  return { base, head, prBodyFile, evidenceFromCommits };
}

/**
 * Pure evidence resolver — priority: env body > PR body file > commit messages > empty.
 * @param {{
 *   envBody: string | null | undefined,
 *   prBodyFile: string | null,
 *   evidenceFromCommits: boolean,
 *   readFile: (path: string) => string,
 *   gitLog: () => string,
 * }} deps
 * @returns {string}
 */
export function resolveEvidence({ envBody, prBodyFile, evidenceFromCommits, readFile, gitLog }) {
  if (envBody != null) {
    return envBody;
  }
  if (prBodyFile) {
    return readFile(prBodyFile);
  }
  if (evidenceFromCommits) {
    return gitLog();
  }
  return "";
}

/**
 * Commit-message evidence with force-push safety: `base..head` (two-dot) for evidence
 * gathering; on failure (base not ancestor / unknown ref) WARN and fall back to
 * `origin/main..head`; never crash.
 * @param {string} base
 * @param {string} head
 * @returns {string}
 */
function getCommitEvidence(base, head) {
  /** @param {string} range */
  const log = (range) =>
    execFileSync("git", ["log", "--format=%B", range], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    return log(`${base}..${head}`);
  } catch {
    console.log(`WARN: git log ${base}..${head} failed — falling back to origin/main..${head}`);
    try {
      return log(`origin/main..${head}`);
    } catch {
      console.log(`WARN: git log origin/main..${head} also failed — evidence empty`);
      return "";
    }
  }
}

/**
 * @param {string} base
 * @param {string} head
 * @param {string} prBody
 */
export function runGateCheck(base, head, prBody) {
  const changedFiles = getChangedFiles(base, head);
  if (changedFiles === null) {
    console.log("gate-check: FAIL — cannot resolve diff range (fail-up)");
    return 1;
  }
  /** @type {Map<string, string[]>} */
  const classification = new Map();

  for (const file of changedFiles) {
    const tags = classifyPath(file);
    classification.set(file, tags);
  }

  let hasHighRisk = [...classification.values()].some((tags) => tags.includes("high-risk"));
  const hasSubstantiveShip = [...classification.values()].some((tags) =>
    tags.includes("substantive-ship"),
  );

  if (changedFiles.includes("package.json")) {
    const basePkg = readPackageJsonAtRef(base);
    const headPkg = readPackageJsonAtRef(head);
    let pkgHighRisk = false;
    if (!basePkg || !headPkg) {
      const badRef = !basePkg ? base : head;
      console.log(`package.json unreadable at ${badRef} — fail-up`);
      pkgHighRisk = true;
    } else if (packageJsonHighRisk(basePkg, headPkg)) {
      pkgHighRisk = true;
    }
    if (pkgHighRisk) {
      hasHighRisk = true;
      const existing = classification.get("package.json") ?? [];
      if (!existing.includes("high-risk")) {
        classification.set("package.json", [...existing, "high-risk"]);
      }
    }
  }

  console.log("Classification:");
  if (classification.size === 0) {
    console.log("  (no changed files)");
  } else {
    for (const [file, tags] of [...classification.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${file} → ${tags.length ? tags.join(", ") : "(none)"}`);
    }
  }

  console.log(
    "Contract: this check verifies string PRESENCE only — it does not prove the Sonnet Task ran (RC-3); forks can forge evidence lines.",
  );

  if (hasSubstantiveShip) {
    console.log(
      "NOTE: product paths changed — D-94: no ship-verifier. HIGH needs security-gate-id; MEDIUM needs one Grok review; LOW none.",
    );
  }

  const evidence = checkEvidence(prBody, hasHighRisk);
  for (const warning of evidence.warnings) {
    console.log(`WARN: ${warning}`);
  }

  if (!hasHighRisk) {
    console.log("gate-check: PASS");
    return 0;
  }

  if (!evidence.pass) {
    for (const item of evidence.missing) {
      console.log(`MISSING: ${item}`);
    }
    console.log(`gate-check: FAIL — missing required evidence (${evidence.missing.join("; ")})`);
    return 1;
  }

  console.log("gate-check: PASS");
  return 0;
}

function main() {
  const { base, head, prBodyFile, evidenceFromCommits } = parseArgs(process.argv.slice(2));
  const prBody = resolveEvidence({
    envBody: process.env.GATE_PR_BODY ?? null,
    prBodyFile,
    evidenceFromCommits,
    readFile: (path) => readFileSync(path, "utf8"),
    gitLog: () => getCommitEvidence(base, head),
  });
  const code = runGateCheck(base, head, prBody);
  process.exit(code);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
