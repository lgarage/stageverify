/**
 * Auto-capture learnings when verify:* or npm run deploy fails.
 * Pending queue → merged to indexer-memory on away:ship (avoids duplicate ingest on retry).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, readJson, writeJson } from "./away-memory-lib.mjs";
import {
  ingestIndexerEntry,
  normalizeIngestInput,
} from "./indexer-ingest-lib.mjs";

export const LEARNING_PENDING_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/learning-pending.json");

/** Default max age before away:validate warns on unresolved pending entries. */
export const PENDING_MAX_AGE_DAYS = 7;

/** In-process session dedup — same script+fingerprint in one Node session skips re-append. */
const SESSION_DEDUP = new Set();

/** @typedef {{
 *   id: string,
 *   scriptName: string,
 *   fingerprint: string,
 *   exitCode: number,
 *   category: string,
 *   summary: string,
 *   triggerTerms: string[],
 *   type: string | null,
 *   subtype: string | null,
 *   gateCandidate: boolean,
 *   domain: string | null,
 *   source?: string | null,
 *   taskHint: string | null,
 *   stderrTail: string | null,
 *   stdoutTail: string | null,
 *   createdAt: string,
 *   mergedAt: string | null,
 *   mergedToId: string | null,
 *   sourceTask: string | null
 * }} PendingVerifyLearning
 *
 * @typedef {{
 *   version: number,
 *   description?: string,
 *   entries: PendingVerifyLearning[]
 * }} PendingLearningsStore
 */

/** @returns {PendingLearningsStore} */
export function loadPendingLearnings() {
  if (!fs.existsSync(LEARNING_PENDING_PATH)) {
    return {
      version: 1,
      description:
        "Auto-captured verify:* and deploy failures — merged to indexer-memory on away:ship; deduped by error fingerprint.",
      entries: [],
    };
  }
  return readJson(LEARNING_PENDING_PATH);
}

/** @param {PendingLearningsStore} store */
export function savePendingLearnings(store) {
  writeJson(LEARNING_PENDING_PATH, store);
}

/** @param {string} text @param {number} maxLines */
export function tailLines(text, maxLines = 40) {
  const lines = text.split(/\r?\n/).filter((line, i, arr) => i < arr.length - 1 || line.length > 0);
  return lines.slice(-maxLines).join("\n");
}

/** @param {string} text */
function normalizeErrorText(text) {
  return text
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
    .replace(/:\d{4,5}\b/g, ":<port>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/**
 * @param {string} scriptName
 * @param {number} exitCode
 * @param {string} stderrTail
 * @param {string} stdoutTail
 */
export function computeErrorFingerprint(scriptName, exitCode, stderrTail, stdoutTail) {
  const normalized = normalizeErrorText(`${stderrTail}\n${stdoutTail}`);
  const key = `${scriptName}|${exitCode}|${normalized}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Scripts that hit gh-pages bundle — not CF/integration/API-only prod checks. */
const BACKEND_VERIFY_PATTERN =
  /phase[34]-integration|inbound-email|material-issue|cf-ingest|email-ingest/i;

/**
 * True when failure is plausibly a stale gh-pages SPA bundle (not backend/API prod checks).
 * @param {string} scriptName
 * @param {string} domain
 */
export function isGhPagesBundleVerify(scriptName, domain) {
  if (BACKEND_VERIFY_PATTERN.test(scriptName)) return false;
  const frontendDomains = new Set([
    "pickup",
    "vendor-receive",
    "invoice-review",
    "dispatcher",
    "settings",
    "email",
  ]);
  if (frontendDomains.has(domain)) return true;
  return /pickup|receive|vendor-delivered|vendor-pin|invoice|settings|dispatcher|portal|oauth|delivery-consistency|public-network/i.test(
    scriptName,
  );
}

/**
 * @param {string} scriptName
 * @param {string[]} forwardArgs
 */
export function isProdVerify(scriptName, forwardArgs = []) {
  if (scriptName.includes(":prod")) return true;
  const baseUrl = process.env.STAGEVERIFY_BASE_URL ?? "";
  if (baseUrl.includes("lgarage.github.io/stageverify")) return true;
  return forwardArgs.some(
    (arg) =>
      arg.includes("lgarage.github.io/stageverify") ||
      arg.startsWith("--base-url=") && arg.includes("github.io"),
  );
}

/** @param {string} scriptName */
function inferDomain(scriptName) {
  if (scriptName.includes("pickup")) return "pickup";
  if (scriptName.includes("receive") || scriptName.includes("vendor")) return "vendor-receive";
  if (scriptName.includes("invoice")) return "invoice-review";
  if (scriptName.includes("dispatcher")) return "dispatcher";
  if (scriptName.includes("settings")) return "settings";
  if (scriptName.includes("email")) return "email";
  return "verify";
}

/** @param {string} scriptName @param {string} domain */
function inferTypeSubtype(scriptName, domain) {
  if (domain === "pickup" || domain === "vendor-receive" || domain === "invoice-review") {
    return { type: "ui-component", subtype: "playwright" };
  }
  if (domain === "dispatcher" || domain === "settings") {
    return { type: "ui-component", subtype: "layout-style" };
  }
  if (scriptName.includes("email-oauth")) {
    return { type: "ui-component", subtype: "playwright" };
  }
  if (scriptName.includes("integration") || scriptName.includes("inbound")) {
    return { type: "backend-write-critical", subtype: "integration" };
  }
  return { type: "service-logic", subtype: "verify" };
}

/**
 * Classify verify failure patterns for summary, category, triggers, gateCandidate.
 * @param {{
 *   scriptName: string,
 *   exitCode: number,
 *   stderrTail: string,
 *   stdoutTail: string,
 *   isProd: boolean,
 *   domain: string,
 *   triggers?: string[]
 * }} ctx
 */
export function classifyVerifyFailure(ctx) {
  const combined = `${ctx.stderrTail}\n${ctx.stdoutTail}`.toLowerCase();
  /** @type {string[]} */
  const triggerTerms = [...(ctx.triggers ?? [])];
  let category = "repeated failure";
  let gateCandidate = false;
  let summary = `${ctx.scriptName} failed (exit ${ctx.exitCode})`;

  const addTerms = (...terms) => {
    for (const t of terms) if (t && !triggerTerms.includes(t)) triggerTerms.push(t);
  };

  const ghPagesProd = ctx.isProd && isGhPagesBundleVerify(ctx.scriptName, ctx.domain);

  if (ghPagesProd) {
    addTerms("prod verify", "gh-pages", "STAGEVERIFY_BASE_URL", ctx.domain);
  }

  if (
    ghPagesProd &&
    (/stale|old bundle|not updated|cache|404|propagation|deploy.*first|redeploy/i.test(combined) ||
      /assert|expected|timeout|not found/i.test(combined))
  ) {
    category = "gotcha";
    gateCandidate = true;
    summary = `${ctx.scriptName} prod verify fail — likely stale gh-pages bundle; redeploy before :prod verify`;
    addTerms("prod verify fail", "stale bundle", "gh-pages stale", "redeploy", "local pass prod fail");
  } else if (/timeout|timed out|waiting for/i.test(combined)) {
    category = "gotcha";
    summary = `${ctx.scriptName} Playwright timeout — check dev server, auth state, or prod propagation lag`;
    addTerms("playwright", "timeout", ctx.domain);
    if (ghPagesProd) gateCandidate = true;
  } else if (/auth|storage.state|login|firebase.*token|expired|STAGEVERIFY_TEST/i.test(combined)) {
    category = "lesson";
    summary = `${ctx.scriptName} auth failure — re-run playwright-auth-setup.mjs (state.json expired ~1h)`;
    addTerms("playwright auth", "storage-state", "firebase token");
  } else if (/econnrefused|listen|5173|dev server/i.test(combined)) {
    category = "lesson";
    summary = `${ctx.scriptName} failed — dev server not running (npm run dev on 5173)`;
    addTerms("dev server", "5173", ctx.domain);
  } else if (ghPagesProd) {
    category = "gotcha";
    summary = `${ctx.scriptName} prod verify failed — confirm gh-pages deploy completed before :prod verify`;
    addTerms("prod verify fail", "gh-pages", "ship loop");
    gateCandidate = true;
  } else if (ctx.isProd && !ghPagesProd) {
    category = "repeated failure";
    summary = `${ctx.scriptName} prod verify failed — check CF deploy, env, or integration fixture`;
    addTerms(ctx.scriptName.replace(/^verify:/, ""), "integration prod verify", ctx.domain);
  } else {
    addTerms(ctx.scriptName.replace(/^verify:/, ""), ctx.domain, "verify failure");
  }

  const { type, subtype } = inferTypeSubtype(ctx.scriptName, ctx.domain);

  return {
    category,
    summary,
    triggerTerms: triggerTerms.slice(0, 10),
    gateCandidate,
    type,
    subtype,
    notes: gateCandidate ? summary : null,
  };
}

/** @param {PendingLearningsStore} store @param {"vfl"|"dfl"} [prefix] */
function nextPendingId(store, prefix = "vfl") {
  let max = 0;
  const re = new RegExp(`^${prefix}-`);
  for (const entry of store.entries ?? []) {
    const n = Number.parseInt(String(entry.id).replace(re, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** True when away:next packet should receive gh-pages/deploy pending gate warnings. */
export function isFrontendGhPagesTask(taskQuery, typeKey) {
  if (typeKey?.startsWith("backend-write-critical")) return false;
  const q = taskQuery.toLowerCase();
  if (/firestore rules|cloud function|schema migration|backend deploy|cf deploy|rules-only|inbound email ingest/i.test(q)) {
    return false;
  }
  return /gh-pages|prod verify|npm run deploy|frontend|ui change|pickup|invoice|settings|dispatcher|:prod|bundle stale|deploy timeout|ship loop|pages build|live bundle/i.test(
    q,
  );
}

/**
 * Classify npm run deploy failure (gh-pages freshness/propagation — not code bugs).
 * @param {{
 *   exitCode: number,
 *   failureKind?: string,
 *   message?: string,
 *   stderrTail: string,
 *   stdoutTail: string,
 *   triggers?: string[]
 * }} ctx
 */
export function classifyDeployFailure(ctx) {
  const combined = `${ctx.message ?? ""}\n${ctx.stderrTail}\n${ctx.stdoutTail}`.toLowerCase();
  /** @type {string[]} */
  const triggerTerms = [...(ctx.triggers ?? [])];
  let category = "gotcha";
  let gateCandidate = true;
  let summary = `npm run deploy failed (exit ${ctx.exitCode})`;

  const addTerms = (...terms) => {
    for (const t of terms) if (t && !triggerTerms.includes(t)) triggerTerms.push(t);
  };

  addTerms("deploy", "gh-pages", "npm run deploy", "ship loop");

  const kind = ctx.failureKind ?? "";

  if (kind === "timeout") {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy timed out waiting for Pages build status=built — gh-pages push may have succeeded; live may still serve old bundle";
    addTerms("deploy timeout", "Pages build status", "propagation", "push succeeded build pending");
  } else if (kind === "stale-bundle") {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy — live bundle mismatch; confirm live index.html main JS asset before :prod verify or claiming live";
    addTerms("live bundle mismatch", "stale bundle", "live index asset", "propagation lag");
  } else if (kind === "build-errored") {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy — GitHub Pages build errored after retry; live may serve stale pre-fix bundle";
    addTerms("Pages build errored", "build failed", "gh-pages stale");
  } else if (kind === "push-failed") {
    category = "lesson";
    gateCandidate = false;
    summary = "npm run deploy — gh-pages branch push failed (no live update)";
    addTerms("gh-pages push failed");
  } else if (kind === "live-fetch-failed") {
    category = "gotcha";
    gateCandidate = true;
    summary = "npm run deploy — could not fetch live index.html to verify bundle freshness";
    addTerms("live fetch", "live index asset", "gh-pages");
  } else if (/timed out.*pages build|waiting for pages build status/i.test(combined)) {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy timed out waiting for Pages build status=built — gh-pages push may have succeeded; live may still serve old bundle";
    addTerms("deploy timeout", "Pages build status", "propagation", "push succeeded build pending");
  } else if (/live bundle mismatch/i.test(combined)) {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy — live bundle mismatch; confirm live index.html main JS asset before :prod verify or claiming live";
    addTerms("live bundle mismatch", "stale bundle", "live index asset", "propagation lag");
  } else if (/pages build errored|build errored after retry/i.test(combined)) {
    category = "gotcha";
    gateCandidate = true;
    summary =
      "npm run deploy — GitHub Pages build errored after retry; live may serve stale pre-fix bundle";
    addTerms("Pages build errored", "build failed", "gh-pages stale");
  } else if (/gh-pages push failed|push failed/i.test(combined)) {
    category = "lesson";
    gateCandidate = false;
    summary = "npm run deploy — gh-pages branch push failed (no live update)";
    addTerms("gh-pages push failed");
  } else if (/live fetch.*failed/i.test(combined)) {
    category = "gotcha";
    gateCandidate = true;
    summary = "npm run deploy — could not fetch live index.html to verify bundle freshness";
    addTerms("live fetch", "live index asset", "gh-pages");
  } else {
    addTerms("deploy fail", "gh-pages deploy");
  }

  return {
    category,
    summary,
    triggerTerms: triggerTerms.slice(0, 10),
    gateCandidate,
    type: "service-logic",
    subtype: "deploy",
    domain: "deploy",
  };
}

/**
 * @param {PendingVerifyLearning} pending
 * @param {{ sourceTask?: string | null }} [opts]
 */
export function pendingToIngestInput(pending, opts = {}) {
  const isDeploy = pending.source === "deploy-auto-capture" || pending.domain === "deploy";
  const mitigation =
    pending.category === "gotcha" && pending.gateCandidate
      ? isDeploy
        ? "Confirm deploy script reported Pages status=built + live index asset matches dist/ before :prod verify; redeploy if timeout or mismatch"
        : "Redeploy gh-pages (npm run deploy), wait for Pages built, rerun :prod verify"
      : pending.category === "lesson"
        ? "See summary — re-run setup or fix environment before retry"
        : null;
  const notes = mitigation
    ? `Root cause: ${pending.summary}${mitigation ? ` Mitigation: ${mitigation}` : ""}`
    : pending.gateCandidate
      ? pending.summary
      : null;

  return {
    summary: pending.summary,
    category: pending.category,
    triggerTerms: pending.triggerTerms,
    type: pending.type,
    subtype: pending.subtype,
    gateCandidate: pending.gateCandidate,
    sourceTask: opts.sourceTask ?? pending.sourceTask ?? null,
    notes,
    relatedFiles: pending.scriptName ? [`package.json#${pending.scriptName}`] : [],
    tags: [
      pending.domain ?? "verify",
      isDeploy ? "deploy-failure" : "verify-failure",
      pending.source ?? (isDeploy ? "deploy-auto-capture" : "verify-auto-capture"),
    ].filter(Boolean),
  };
}

/**
 * Collect gateCandidate warnings from unmerged pending learnings (deploy + gh-pages verify).
 * @param {string} taskQuery
 * @param {string | null} typeKey
 */
export function collectPendingLearningGateWarnings(taskQuery, typeKey) {
  if (!isFrontendGhPagesTask(taskQuery, typeKey)) return [];

  const store = loadPendingLearnings();
  const q = taskQuery.toLowerCase();
  /** @type {string[]} */
  const warnings = [];

  for (const entry of store.entries) {
    if (entry.mergedAt || !entry.gateCandidate) continue;

    const isDeploy = entry.source === "deploy-auto-capture" || entry.domain === "deploy";
    const isVerifyGhPages =
      entry.source === "verify-auto-capture" &&
      (entry.triggerTerms ?? []).some((t) => /gh-pages|stale|prod verify|redeploy/i.test(t));

    if (!isDeploy && !isVerifyGhPages) continue;

    const termMatch = (entry.triggerTerms ?? []).some((t) => {
      const tl = t.toLowerCase();
      return tl.length >= 4 && q.includes(tl);
    });

    if (!termMatch) {
      if (isDeploy && !/deploy|gh-pages|prod verify|frontend|ship loop|bundle|pages build/i.test(q)) {
        continue;
      }
      if (isVerifyGhPages && !/prod verify|gh-pages|stale|pickup|invoice|frontend|:prod/i.test(q)) {
        continue;
      }
    }

    const input = pendingToIngestInput(entry);
    const warning = input.notes?.trim() || entry.summary;
    if (
      warning &&
      !warnings.some(
        (existing) =>
          existing.toLowerCase().includes(warning.toLowerCase()) ||
          warning.toLowerCase().includes(existing.toLowerCase()),
      )
    ) {
      warnings.push(warning);
    }
  }

  return warnings.slice(0, 2);
}

/**
 * Capture a verify failure to the pending queue (deduped by fingerprint).
 * @param {{
 *   scriptName: string,
 *   exitCode: number,
 *   stderrTail?: string,
 *   stdoutTail?: string,
 *   taskHint?: string | null,
 *   domain?: string | null,
 *   triggers?: string[],
 *   forwardArgs?: string[],
 *   dryRun?: boolean
 * }} opts
 */
export function captureVerifyFailure(opts) {
  const stderrTail = opts.stderrTail ?? "";
  const stdoutTail = opts.stdoutTail ?? "";
  const domain = opts.domain ?? inferDomain(opts.scriptName);
  const isProd = isProdVerify(opts.scriptName, opts.forwardArgs ?? []);
  const classified = classifyVerifyFailure({
    scriptName: opts.scriptName,
    exitCode: opts.exitCode,
    stderrTail,
    stdoutTail,
    isProd,
    domain,
    triggers: opts.triggers,
  });

  const fingerprint = computeErrorFingerprint(
    opts.scriptName,
    opts.exitCode,
    stderrTail,
    stdoutTail,
  );

  if (SESSION_DEDUP.has(fingerprint)) {
    return { action: "dedup-session", fingerprint, dryRun: opts.dryRun ?? false };
  }

  const store = loadPendingLearnings();
  const existing = store.entries.find(
    (e) => !e.mergedAt && e.fingerprint === fingerprint && e.scriptName === opts.scriptName,
  );

  if (existing) {
    SESSION_DEDUP.add(fingerprint);
    return {
      action: "dedup-pending",
      id: existing.id,
      fingerprint,
      dryRun: opts.dryRun ?? false,
    };
  }

  /** @type {PendingVerifyLearning} */
  const entry = {
    id: nextPendingId(store),
    scriptName: opts.scriptName,
    fingerprint,
    exitCode: opts.exitCode,
    category: classified.category,
    summary: classified.summary,
    triggerTerms: classified.triggerTerms,
    type: classified.type,
    subtype: classified.subtype,
    gateCandidate: classified.gateCandidate,
    domain,
    source: "verify-auto-capture",
    taskHint: opts.taskHint ?? null,
    stderrTail: stderrTail.slice(-2000) || null,
    stdoutTail: stdoutTail.slice(-2000) || null,
    createdAt: new Date().toISOString(),
    mergedAt: null,
    mergedToId: null,
    sourceTask: null,
  };

  if (opts.dryRun) {
    SESSION_DEDUP.add(fingerprint);
    return { action: "pending-capture", entry, dryRun: true };
  }

  store.entries.push(entry);
  savePendingLearnings(store);
  SESSION_DEDUP.add(fingerprint);

  console.error(
    `verify-learning: captured pending ${entry.id} for ${opts.scriptName} (${classified.category})`,
  );

  return { action: "pending-capture", entry, dryRun: false };
}

/**
 * Capture npm run deploy failure to the pending queue (deduped by fingerprint).
 * @param {{
 *   exitCode?: number,
 *   failureKind?: string,
 *   message?: string,
 *   stderrTail?: string,
 *   stdoutTail?: string,
 *   triggers?: string[],
 *   dryRun?: boolean
 * }} opts
 */
export function captureDeployFailure(opts) {
  const scriptName = "deploy";
  const exitCode = opts.exitCode ?? 1;
  const stderrTail = opts.stderrTail ?? "";
  const stdoutTail = opts.stdoutTail ?? "";
  const classified = classifyDeployFailure({
    exitCode,
    failureKind: opts.failureKind,
    message: opts.message,
    stderrTail,
    stdoutTail,
    triggers: opts.triggers,
  });

  const fingerprint = computeErrorFingerprint(
    scriptName,
    exitCode,
    `${opts.failureKind ?? ""}\n${stderrTail}`,
    stdoutTail,
  );

  if (SESSION_DEDUP.has(fingerprint)) {
    return { action: "dedup-session", fingerprint, dryRun: opts.dryRun ?? false };
  }

  const store = loadPendingLearnings();
  const existing = store.entries.find(
    (e) => !e.mergedAt && e.fingerprint === fingerprint && e.scriptName === scriptName,
  );

  if (existing) {
    SESSION_DEDUP.add(fingerprint);
    return {
      action: "dedup-pending",
      id: existing.id,
      fingerprint,
      dryRun: opts.dryRun ?? false,
    };
  }

  /** @type {PendingVerifyLearning} */
  const entry = {
    id: nextPendingId(store, "dfl"),
    scriptName,
    fingerprint,
    exitCode,
    category: classified.category,
    summary: classified.summary,
    triggerTerms: classified.triggerTerms,
    type: classified.type,
    subtype: classified.subtype,
    gateCandidate: classified.gateCandidate,
    domain: classified.domain,
    source: "deploy-auto-capture",
    taskHint: opts.failureKind ?? null,
    stderrTail: stderrTail.slice(-2000) || null,
    stdoutTail: stdoutTail.slice(-2000) || null,
    createdAt: new Date().toISOString(),
    mergedAt: null,
    mergedToId: null,
    sourceTask: null,
  };

  if (opts.dryRun) {
    SESSION_DEDUP.add(fingerprint);
    return { action: "pending-capture", entry, dryRun: true };
  }

  store.entries.push(entry);
  savePendingLearnings(store);
  SESSION_DEDUP.add(fingerprint);

  console.error(
    `deploy-learning: captured pending ${entry.id} (${classified.category}) — ${classified.summary}`,
  );

  return { action: "pending-capture", entry, dryRun: false };
}

/** @param {string} scriptName @param {{ dryRun?: boolean }} [opts] */
export function clearPendingForScript(scriptName, opts = {}) {
  const store = loadPendingLearnings();
  const before = store.entries.length;
  store.entries = store.entries.filter(
    (e) => e.mergedAt || e.scriptName !== scriptName,
  );
  const removed = before - store.entries.length;
  if (removed > 0 && !opts.dryRun) {
    savePendingLearnings(store);
    console.error(`verify-learning: cleared ${removed} pending entr${removed === 1 ? "y" : "ies"} for ${scriptName}`);
  }
  return { removed, dryRun: opts.dryRun ?? false };
}

/**
 * Merge unmerged pending verify failures into indexer-memory (called from away:ship).
 * @param {{ sourceTask?: string | null, dryRun?: boolean, maxAgeDays?: number }} [opts]
 */
export function mergePendingVerifyLearnings(opts = {}) {
  const store = loadPendingLearnings();
  const pending = store.entries.filter((e) => !e.mergedAt);
  if (pending.length === 0) return { merged: [], dryRun: opts.dryRun ?? false };

  /** @type {{ pendingId: string, indexerId?: string, action: string }[]} */
  const merged = [];

  for (const entry of pending) {
    const input = pendingToIngestInput(entry, { sourceTask: opts.sourceTask ?? null });
    const normalized = normalizeIngestInput(input);
    const typeKey =
      normalized.type && normalized.subtype
        ? `${normalized.type}/${normalized.subtype}`
        : normalized.type ?? undefined;

    const result = ingestIndexerEntry(normalized, {
      dryRun: opts.dryRun ?? false,
      typeKey,
    });

    if (!opts.dryRun) {
      entry.mergedAt = new Date().toISOString();
      entry.sourceTask = opts.sourceTask ?? entry.sourceTask;
      if (result.action === "indexer-memory" && result.entry?.id) {
        entry.mergedToId = result.entry.id;
        merged.push({ pendingId: entry.id, indexerId: result.entry.id, action: result.action });
      } else {
        merged.push({ pendingId: entry.id, action: result.action });
      }
    } else {
      merged.push({
        pendingId: entry.id,
        indexerId:
          result.action === "indexer-memory" && result.entry?.id ? result.entry.id : undefined,
        action: result.action,
      });
    }
  }

  if (!opts.dryRun && merged.length > 0) {
    savePendingLearnings(store);
    console.error(
      `verify-learning: merged ${merged.length} pending verify failure(s) to indexer-memory`,
    );
  }

  return { merged, dryRun: opts.dryRun ?? false };
}

/** @param {PendingLearningsStore} [store] */
export function validatePendingLearnings(store) {
  const doc = store ?? loadPendingLearnings();
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const now = Date.now();
  const maxAgeMs = PENDING_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  if (!Array.isArray(doc.entries)) {
    errors.push("learning-pending.json: entries must be an array");
    return { errors, warnings };
  }

  const ids = new Set();
  for (const entry of doc.entries) {
    const label = entry.id ?? "?";
    if (!entry.id) errors.push("learning-pending.json: entry missing id");
    else if (ids.has(entry.id)) errors.push(`learning-pending.json: duplicate id ${entry.id}`);
    else ids.add(entry.id);

    if (!entry.scriptName?.trim()) errors.push(`learning-pending.json: ${label} missing scriptName`);
    if (!entry.summary?.trim()) errors.push(`learning-pending.json: ${label} missing summary`);
    if (!entry.fingerprint?.trim()) errors.push(`learning-pending.json: ${label} missing fingerprint`);
    if (!entry.category?.trim()) errors.push(`learning-pending.json: ${label} missing category`);
    if (!Array.isArray(entry.triggerTerms) || entry.triggerTerms.length === 0) {
      errors.push(`learning-pending.json: ${label} missing triggerTerms`);
    }

    if (!entry.mergedAt) {
      if (!entry.type?.trim()) errors.push(`learning-pending.json: ${label} missing type`);
      if (!entry.subtype?.trim()) errors.push(`learning-pending.json: ${label} missing subtype`);
      if (!entry.domain?.trim()) errors.push(`learning-pending.json: ${label} missing domain`);
      if (!entry.source?.trim()) {
        warnings.push(
          `learning-pending.json: ${label} missing source (expected verify-auto-capture or deploy-auto-capture)`,
        );
      } else if (
        !["verify-auto-capture", "deploy-auto-capture"].includes(entry.source)
      ) {
        warnings.push(`learning-pending.json: ${label} unknown source ${entry.source}`);
      }
    }

    if (!entry.mergedAt && entry.createdAt) {
      const age = now - Date.parse(entry.createdAt);
      if (Number.isFinite(age) && age > maxAgeMs) {
        warnings.push(
          `learning-pending.json: ${label} unresolved for >${PENDING_MAX_AGE_DAYS}d (${entry.scriptName}) — merge on away:ship or clear after fix`,
        );
      }
    }
  }

  const unresolved = doc.entries.filter((e) => !e.mergedAt).length;
  if (unresolved > 5) {
    warnings.push(
      `learning-pending.json: ${unresolved} unresolved pending learning entries — review before next ship`,
    );
  }

  return { errors, warnings };
}
