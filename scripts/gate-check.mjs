#!/usr/bin/env node
/**
 * PR evidence gate checker — mechanical presence-only verification for high-risk diffs.
 *
 * Intentionally stricter than ship-loop.mdc (fail-up): CF read-path implementation is
 * fast-safe per ship-loop, but a PR with functions/ changes precedes a possible deploy;
 * misclassifying down is the failure mode.
 *
 * src/** auth heuristic (/auth|session|token|guard|login/i) is approximate fail-up —
 * false positives accepted.
 *
 * Root package.json: high-risk on scripts diff or firebase MAJOR bump only; other
 * non-scripts deploy wiring documented as v1 out-of-scope in this header.
 *
 * The check does not validate the verdict value — a PR body with `verdict: HIGH` or
 * `NOT RUN` still passes the presence check. Known v1 gap, presence-only by design (D-28).
 *
 * Self-bypass caveat: a fork PR can modify gate-check.mjs itself to neuter the check on
 * the merge ref — this gate is advisory-vs-malice, protective-vs-honest-mistakes; branch
 * protection + human review remain the backstop for hostile PRs.
 *
 * Run: npm run gate:check [-- --base <ref> --head <ref> --pr-body-file <path> | --evidence-from-commits]
 * Evidence priority: env GATE_PR_BODY > --pr-body-file > --evidence-from-commits > empty.
 * --evidence-from-commits reads `git log --format=%B base..head` — direct pushes to main
 * (desktop, pre-push hook) carry the evidence block in commit messages; same presence-only
 * contract as PR bodies.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SECURITY_GATE_ID_RE =
  /security-gate-id:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

export const REQUIRED_MODEL_LINE = "model: claude-4.6-sonnet-medium-thinking";

const AUTH_HEURISTIC = /auth|session|token|guard|login/i;

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
  if (p.startsWith("functions/") && !p.startsWith("functions/lib/")) {
    tags.push("high-risk");
  }
  if (p.startsWith(".github/workflows/")) {
    tags.push("high-risk");
  }
  if (p === "firebase.json") {
    tags.push("high-risk");
  }
  if (p.startsWith("src/") && AUTH_HEURISTIC.test(p)) {
    tags.push("high-risk");
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

  if (!SECURITY_GATE_ID_RE.test(prBody)) {
    missing.push("security-gate-id: <lowercase-hex UUID 8-4-4-4-12>");
  }
  if (!prBody.includes(REQUIRED_MODEL_LINE)) {
    missing.push(REQUIRED_MODEL_LINE);
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
      "NOTE: substantive-ship paths changed — ship-verifier: line required post-ship (post-push, not enforced at PR time)",
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
