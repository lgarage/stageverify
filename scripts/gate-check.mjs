#!/usr/bin/env node
/**
 * PR evidence gate checker — mechanical presence-only verification for HIGH-tier diffs (D-94).
 *
 * HIGH (security-gate-id required): all `functions/` except `lib/` (D-28); firestore.rules;
 * auth/PIN/roles; billing; CI/gate config (.github/workflows, firebase.json, gate-check,
 * install-git-hooks, ship-evidence-preflight, root package.json scripts / firebase major).
 *
 * Sonnet backup (Grok + claude-sonnet model lines) mechanically required on firestore.rules,
 * auth/PIN/roles, and billing/money paths — not on gate-config-only HIGH.
 * UI / copy / docs are LOW — no security-gate-id.
 *
 * src/** auth heuristic (/auth|session|token|guard|login|pin|role/i) is approximate fail-up.
 *
 * The check does not validate verdict PASS/HIGH — presence-only by design (D-28).
 * The **security-gate-id value** must be a lowercase UUID or `bc-<uuid>`; `NOT RUN`,
 * empty, and junk id values fail.
 *
 * Model line (D-94 / D-38): HIGH requires `model:` matching ALLOWED_GATE_MODELS
 * (primary `cursor-grok-4.6-high`; `cursor-grok-4.6-xhigh`; Sonnet escalation).
 * Missing or non-allowlist model fails mechanical CI.
 *
 * Self-bypass caveat: a fork PR can modify gate-check.mjs itself to neuter the check on
 * the merge ref — this gate is advisory-vs-malice; branch protection + human review
 * remain the backstop for hostile PRs. GATE_SKIP is never honored in this script (CI or local).
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

/** Preference order (D-94): Grok top model primary; Sonnet 5 escalation only. */
export const ALLOWED_GATE_MODELS = [
  "cursor-grok-4.6-high",
  "cursor-grok-4.6-xhigh",
  "claude-sonnet-5-thinking-high",
];

/** @deprecated Use ALLOWED_GATE_MODELS — kept for tests referencing primary slug */
export const REQUIRED_MODEL_LINE = `model: ${ALLOWED_GATE_MODELS[0]}`;

export const MISSING_MODEL_LINE_HINT = `model: <allowlisted slug per D-38 (${ALLOWED_GATE_MODELS.join(" | ")})>`;

export const MISSING_GROK_MODEL_HINT =
  "model: cursor-grok-4.6-high (or cursor-grok-4.6-xhigh) — required with Sonnet on rules/auth/billing paths";

export const MISSING_SONNET_BACKUP_HINT =
  "model: claude-sonnet-5-thinking-high — required in addition to Grok on rules/auth/billing paths";

export const AUTHOR_GATE_ID_HINT =
  "security-gate-id must not equal the PR author agent id (use reviewer Task id or bc-<uuid>)";

const GROK_GATE_MODELS = ["cursor-grok-4.6-high", "cursor-grok-4.6-xhigh"];

const SONNET_GATE_MODEL = "claude-sonnet-5-thinking-high";

/** @param {string} slug */
function escapeRegExp(slug) {
  return slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Exact whole-slug match after `model:` — suffixes like `-fast` must not match shorter slugs.
 * @param {string} text
 * @returns {string[]} allowlisted slugs found (deduped, preference order)
 */
export function extractGateModelSlugs(text) {
  /** @type {string[]} */
  const found = [];
  for (const slug of ALLOWED_GATE_MODELS) {
    const re = new RegExp(`model:\\s*${escapeRegExp(slug)}(?![a-z0-9.-])`, "i");
    if (re.test(text) && !found.includes(slug)) {
      found.push(slug);
    }
  }
  return found;
}

/**
 * @param {string} prBody
 * @returns {boolean}
 */
export function hasAllowedGateModel(prBody) {
  return extractGateModelSlugs(extractReviewEvidenceText(prBody)).length > 0;
}

/**
 * Review evidence only — not docs/examples in code spans or fenced blocks.
 * @param {string} rawBody
 * @returns {string}
 */
export function extractReviewEvidenceText(rawBody) {
  const htmlMatch = rawBody.match(
    /<!--\s*review-evidence\s*-->([\s\S]*?)<!--\s*\/review-evidence\s*-->/i,
  );
  if (htmlMatch) {
    return htmlMatch[1].trim();
  }

  const headingRe = /^##\s+Review evidence[ \t]*$/im;
  const headingMatch = headingRe.exec(rawBody);
  if (headingMatch) {
    const afterHeading = rawBody.slice(headingMatch.index + headingMatch[0].length);
    const nextHeading = afterHeading.search(/^##\s/m);
    const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
    return section.trim();
  }

  let stripped = rawBody.replace(/```[\s\S]*?```/g, "");
  stripped = stripped.replace(/`[^`]*`/g, "");
  return stripped;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function normalizeAgentId(id) {
  return id.replace(/^bc-/i, "").toLowerCase();
}

/**
 * @param {string} rawBody PR body (for footer agent links)
 * @param {string | null | undefined} envAuthor GATE_PR_AUTHOR_AGENT
 * @returns {Set<string>} normalized uuid hex (no bc- prefix)
 */
export function extractAuthorAgentIds(rawBody, envAuthor) {
  /** @type {Set<string>} */
  const ids = new Set();
  if (envAuthor && String(envAuthor).trim()) {
    ids.add(normalizeAgentId(String(envAuthor).trim()));
  }
  const linkRe =
    /cursor\.com\/(?:agents|background-agent)\/(?:bc-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
  let m;
  while ((m = linkRe.exec(rawBody)) !== null) {
    ids.add(normalizeAgentId(m[1]));
  }
  return ids;
}

/**
 * @param {string} gateIdValue raw id token (may include bc-)
 * @param {Set<string>} authorIds normalized ids
 * @returns {boolean}
 */
export function gateIdEqualsAuthor(gateIdValue, authorIds) {
  if (!gateIdValue || authorIds.size === 0) {
    return false;
  }
  return authorIds.has(normalizeAgentId(gateIdValue));
}

const AUTH_HEURISTIC = /auth|session|token|guard|login|pin|role/i;

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
    tags.push("high-risk");
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
 * Sonnet backup (Grok + Sonnet model lines) — rules, auth/PIN/roles, billing/money only.
 * @param {string} filePath
 * @returns {boolean}
 */
export function requiresSonnetBackup(filePath) {
  const p = filePath.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (p === "firestore.rules") {
    return true;
  }
  const inProduct = p.startsWith("src/") || p.startsWith("functions/");
  if (!inProduct) {
    return false;
  }
  if (AUTH_HEURISTIC.test(p)) {
    return true;
  }
  return /billing|money/i.test(p);
}

/**
 * @param {boolean} envValue
 * @returns {boolean} gate-check never honors GATE_SKIP (testable)
 */
export function shouldHonorGateSkip(_env = process.env) {
  return false;
}

/** @returns {boolean} */
export function honorsGateSkip() {
  return false;
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
 * @param {string} prBody raw PR body or evidence text
 * @param {boolean} hasHighRisk
 * @param {{ requiresSonnetBackup?: boolean, authorAgentIds?: Set<string>, useRawBody?: boolean }} [options]
 * @returns {{ pass: boolean, missing: string[], warnings: string[] }}
 */
export function checkEvidence(prBody, hasHighRisk, options = {}) {
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const warnings = [];

  if (!hasHighRisk) {
    return { pass: true, missing, warnings };
  }

  const evidenceText = options.useRawBody ? prBody : extractReviewEvidenceText(prBody);
  const authorIds = options.authorAgentIds ?? new Set();

  if (!hasValidSecurityGateId(evidenceText)) {
    missing.push(MISSING_SECURITY_GATE_ID_HINT);
  } else {
    const gateValue = extractSecurityGateIdValue(evidenceText);
    if (gateValue && gateIdEqualsAuthor(gateValue, authorIds)) {
      missing.push(AUTHOR_GATE_ID_HINT);
    }
  }

  const slugs = extractGateModelSlugs(evidenceText);
  const needsSonnet = options.requiresSonnetBackup === true;

  if (needsSonnet) {
    const hasGrok = slugs.some((s) => GROK_GATE_MODELS.includes(s));
    const hasSonnet = slugs.includes(SONNET_GATE_MODEL);
    if (!hasGrok) {
      missing.push(MISSING_GROK_MODEL_HINT);
    }
    if (!hasSonnet) {
      missing.push(MISSING_SONNET_BACKUP_HINT);
    }
  } else if (slugs.length === 0) {
    missing.push(MISSING_MODEL_LINE_HINT);
  }

  if (!/actual model invocation evidence:/i.test(evidenceText)) {
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
    "Contract: this check verifies string PRESENCE only — it does not prove the Grok (or escalation) review ran (RC-3); forks can forge evidence lines.",
  );

  const needsSonnetBackup = changedFiles.some((file) => requiresSonnetBackup(file));

  if (hasSubstantiveShip) {
    console.log(
      "NOTE: product paths changed — D-94: no ship-verifier. HIGH needs security-gate-id + model:; MEDIUM and LOW need one Grok accuracy review of Composer code.",
    );
  }

  const authorAgentIds = extractAuthorAgentIds(
    prBody,
    process.env.GATE_PR_AUTHOR_AGENT ?? null,
  );

  const evidence = checkEvidence(prBody, hasHighRisk, {
    requiresSonnetBackup: needsSonnetBackup,
    authorAgentIds,
  });
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
  if (process.env.GATE_SKIP === "1") {
    const where = process.env.CI ? "CI" : "local";
    console.log(`WARN: GATE_SKIP=1 ignored — gate-check always runs (${where})`);
  }

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
