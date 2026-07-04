/**
 * Auto-capture learnings when verify:* scripts fail.
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
        "Auto-captured verify:* failures — merged to indexer-memory on away:ship; deduped by error fingerprint.",
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

const PROD_GH_PAGES = "https://lgarage.github.io/stageverify";

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
  if (scriptName.includes("integration") || scriptName.includes("inbound")) {
    return { type: "service-logic", subtype: "integration" };
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

  if (ctx.isProd) {
    addTerms("prod verify", "gh-pages", "STAGEVERIFY_BASE_URL", ctx.domain);
    gateCandidate = true;
  }

  if (
    /stale|old bundle|not updated|cache|404|propagation|deploy.*first|redeploy/i.test(combined) ||
    (ctx.isProd && /assert|expected|timeout|not found/i.test(combined))
  ) {
    category = "gotcha";
    gateCandidate = true;
    summary = `${ctx.scriptName} prod verify fail — likely stale gh-pages bundle; redeploy before :prod verify`;
    addTerms("prod verify fail", "stale bundle", "gh-pages stale", "redeploy", "local pass prod fail");
  } else if (/timeout|timed out|waiting for/i.test(combined)) {
    category = "gotcha";
    summary = `${ctx.scriptName} Playwright timeout — check dev server, auth state, or prod propagation lag`;
    addTerms("playwright", "timeout", ctx.domain);
    if (ctx.isProd) gateCandidate = true;
  } else if (/auth|storage.state|login|firebase.*token|expired|STAGEVERIFY_TEST/i.test(combined)) {
    category = "lesson";
    summary = `${ctx.scriptName} auth failure — re-run playwright-auth-setup.mjs (state.json expired ~1h)`;
    addTerms("playwright auth", "storage-state", "firebase token");
  } else if (/econnrefused|listen|5173|dev server/i.test(combined)) {
    category = "lesson";
    summary = `${ctx.scriptName} failed — dev server not running (npm run dev on 5173)`;
    addTerms("dev server", "5173", ctx.domain);
  } else if (ctx.isProd) {
    category = "gotcha";
    summary = `${ctx.scriptName} prod verify failed — confirm gh-pages deploy completed before :prod verify`;
    addTerms("prod verify fail", "gh-pages", "ship loop");
    gateCandidate = true;
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

/** @param {PendingLearningsStore} store */
function nextPendingId(store) {
  let max = 0;
  for (const entry of store.entries ?? []) {
    const n = Number.parseInt(String(entry.id).replace(/^vfl-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `vfl-${String(max + 1).padStart(3, "0")}`;
}

/**
 * @param {PendingVerifyLearning} pending
 * @param {{ sourceTask?: string | null }} [opts]
 */
export function pendingToIngestInput(pending, opts = {}) {
  return {
    summary: pending.summary,
    category: pending.category,
    triggerTerms: pending.triggerTerms,
    type: pending.type,
    subtype: pending.subtype,
    gateCandidate: pending.gateCandidate,
    sourceTask: opts.sourceTask ?? pending.sourceTask ?? null,
    notes: pending.gateCandidate ? pending.summary : null,
    relatedFiles: pending.scriptName ? [`package.json#${pending.scriptName}`] : [],
    tags: [pending.domain ?? "verify", "verify-failure"].filter(Boolean),
  };
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
      `learning-pending.json: ${unresolved} unresolved verify-failure entries — review before next ship`,
    );
  }

  return { errors, warnings };
}
