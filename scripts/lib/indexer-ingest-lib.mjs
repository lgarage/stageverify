/**
 * Mini-librarian indexer — intelligent ingestion, deterministic retrieval.
 * SSOT references only: LIBRARIAN_LESSONS.md, gotcha-map.json; structured overflow → indexer-memory.json.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, readJson, readText, writeJson } from "./away-memory-lib.mjs";
import { validateEntryRange } from "./dossier-index-lib.mjs";
import { loadGotchaMap } from "./gotcha-map-lib.mjs";
import { appendLessonBullet } from "./librarian-lessons-lib.mjs";

export const INDEXER_MEMORY_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/indexer-memory.json");
export const GOTCHA_MAP_PATH = path.join(REPO_ROOT, "PROJECT_STATUS/gotcha-map.json");

/** @type {readonly string[]} */
export const INDEXER_CATEGORIES = [
  "decision",
  "lesson",
  "gotcha",
  "repeated failure",
  "success pattern",
  "estimate/timing signal",
  "model-routing note",
  "stale/archivable context",
  "future task idea",
];

/**
 * @typedef {{
 *   id: string,
 *   category: string,
 *   summary: string,
 *   canonicalLocation: string,
 *   sourceTask?: string | null,
 *   sourceCommit?: string | null,
 *   tags?: string[],
 *   triggerTerms?: string[],
 *   type?: string | null,
 *   subtype?: string | null,
 *   slice?: { file: string, startLine: number, endLine: number, anchor?: string } | null,
 *   relatedFiles?: string[],
 *   confidence?: number,
 *   injectBeforeWork?: boolean,
 *   promotionCandidate?: boolean,
 *   gateCandidate?: boolean,
 *   createdAt?: string,
 *   notes?: string | null
 * }} IndexerMemoryEntry
 *
 * @typedef {{
 *   version: number,
 *   description?: string,
 *   entries: IndexerMemoryEntry[]
 * }} IndexerMemoryStore
 */

/** @returns {IndexerMemoryStore} */
export function loadIndexerMemory() {
  if (!fs.existsSync(INDEXER_MEMORY_PATH)) {
    return {
      version: 1,
      description:
        "Structured indexer overflow — references SSOTs; retrieve via trigger term + type/subtype match only.",
      entries: [],
    };
  }
  return readJson(INDEXER_MEMORY_PATH);
}

/** @param {IndexerMemoryStore} store */
export function saveIndexerMemory(store) {
  writeJson(INDEXER_MEMORY_PATH, store);
}

/** @param {IndexerMemoryStore} store */
export function nextIndexerId(store) {
  let max = 0;
  for (const entry of store.entries ?? []) {
    const n = Number.parseInt(String(entry.id).replace(/^idx-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `idx-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Infer category from summary text when not explicitly provided.
 * @param {string} summary
 * @param {string | undefined} hint
 */
export function inferCategory(summary, hint) {
  if (hint && INDEXER_CATEGORIES.includes(hint)) return hint;
  const s = summary.toLowerCase();
  if (/\bgotcha\b|watch out|don't repeat|pitfall/.test(s)) return "gotcha";
  if (/\blesson\b|learned|remember to/.test(s)) return "lesson";
  if (/\bdecided\b|decision|we chose|authority/.test(s)) return "decision";
  if (/\bfailed twice|repeated fail|keeps failing/.test(s)) return "repeated failure";
  if (/\bsuccess pattern|works when|clean pass/.test(s)) return "success pattern";
  if (/\bestimate|timing|budget|elapsed/.test(s)) return "estimate/timing signal";
  if (/\bmodel routing|sonnet|composer|tier\b/.test(s)) return "model-routing note";
  if (/\bstale|archive|outdated context/.test(s)) return "stale/archivable context";
  if (/\bfuture|queue|away-|next build/.test(s)) return "future task idea";
  return "decision";
}

/** @param {string} category */
export function canonicalLocationForCategory(category) {
  switch (category) {
    case "lesson":
      return "PROJECT_STATUS/LIBRARIAN_LESSONS.md (via librarian-lessons-index.json)";
    case "gotcha":
      return "PROJECT_STATUS/gotcha-map.json";
    default:
      return "PROJECT_STATUS/indexer-memory.json";
  }
}

/**
 * @param {Record<string, unknown>} input
 * @returns {Omit<IndexerMemoryEntry, "id" | "createdAt"> & { category: string }}
 */
export function normalizeIngestInput(input) {
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (!summary) throw new Error("ingest: summary is required");

  const category = inferCategory(
    summary,
    typeof input.category === "string" ? input.category.trim() : undefined,
  );

  const type = typeof input.type === "string" ? input.type.trim() || null : null;
  const subtype = typeof input.subtype === "string" ? input.subtype.trim() || null : null;

  /** @type {string[]} */
  let triggerTerms = [];
  if (Array.isArray(input.triggerTerms)) {
    triggerTerms = input.triggerTerms.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof input.trigger === "string" && input.trigger.trim()) {
    triggerTerms = input.trigger.split(",").map((t) => t.trim()).filter(Boolean);
  } else if (typeof input.triggers === "string" && input.triggers.trim()) {
    triggerTerms = input.triggers.split(",").map((t) => t.trim()).filter(Boolean);
  }

  /** @type {{ file: string, startLine: number, endLine: number, anchor?: string } | null} */
  let slice = null;
  if (input.slice && typeof input.slice === "object") {
    const s = /** @type {{ file?: string, startLine?: number, endLine?: number, anchor?: string }} */ (
      input.slice
    );
    if (s.file && s.startLine && s.endLine) {
      slice = {
        file: s.file,
        startLine: s.startLine,
        endLine: s.endLine,
        ...(typeof s.anchor === "string" && s.anchor.trim() ? { anchor: s.anchor.trim() } : {}),
      };
    }
  }

  const injectBeforeWork =
    typeof input.injectBeforeWork === "boolean"
      ? input.injectBeforeWork
      : category !== "stale/archivable context" && category !== "future task idea";

  const promotionCandidate =
    typeof input.promotionCandidate === "boolean"
      ? input.promotionCandidate
      : category === "gotcha" || category === "repeated failure";

  const gateCandidate =
    typeof input.gateCandidate === "boolean" ? input.gateCandidate : false;

  return {
    category,
    summary,
    canonicalLocation: canonicalLocationForCategory(category),
    sourceTask: typeof input.sourceTask === "string" ? input.sourceTask.trim() : null,
    sourceCommit: typeof input.sourceCommit === "string" ? input.sourceCommit.trim() : null,
    tags: Array.isArray(input.tags)
      ? input.tags.map((t) => String(t).trim()).filter(Boolean)
      : [],
    triggerTerms,
    type,
    subtype,
    slice,
    relatedFiles: Array.isArray(input.relatedFiles)
      ? input.relatedFiles.map((f) => String(f).trim()).filter(Boolean)
      : [],
    confidence:
      typeof input.confidence === "number"
        ? Math.min(1, Math.max(0, input.confidence))
        : 0.85,
    injectBeforeWork,
    promotionCandidate,
    gateCandidate,
    notes: typeof input.notes === "string" ? input.notes.trim() : null,
  };
}

/**
 * @param {ReturnType<typeof normalizeIngestInput>} normalized
 * @param {{ dryRun?: boolean, applyGotcha?: boolean, typeKey?: string, bullet?: string }} opts
 */
export function ingestIndexerEntry(normalized, opts = {}) {
  const { dryRun = false, applyGotcha = false } = opts;
  const category = normalized.category;

  if (category === "lesson") {
    const typeKey =
      opts.typeKey ??
      (normalized.type && normalized.subtype
        ? `${normalized.type}/${normalized.subtype}`
        : normalized.type
          ? `${normalized.type}/general`
          : null);
    if (!typeKey) {
      throw new Error("lesson ingest requires --type <type>/<subtype> or input.type + input.subtype");
    }
    const bullet = opts.bullet ?? normalized.summary;
    if (dryRun) {
      return {
        action: "lesson",
        canonicalLocation: normalized.canonicalLocation,
        typeKey,
        bullet,
        dryRun: true,
      };
    }
    const result = appendLessonBullet({ typeKey, bullet });
    return {
      action: "lesson",
      canonicalLocation: normalized.canonicalLocation,
      section: result.section,
      insertAt: result.insertAt,
      bulletLine: result.bulletLine,
    };
  }

  if (category === "gotcha" || (normalized.promotionCandidate && applyGotcha)) {
    const proposal = buildGotchaProposal(normalized);
    if (!applyGotcha) {
      return {
        action: "gotcha-proposal",
        canonicalLocation: "PROJECT_STATUS/gotcha-map.json",
        proposal,
        dryRun: true,
        message: "Pass --apply-gotcha to append trigger to gotcha-map.json",
      };
    }
    if (dryRun) {
      return { action: "gotcha-proposal", proposal, dryRun: true };
    }
    appendGotchaTrigger(proposal);
    return { action: "gotcha-applied", canonicalLocation: normalized.canonicalLocation, proposal };
  }

  const store = loadIndexerMemory();
  const entry = /** @type {IndexerMemoryEntry} */ ({
    id: nextIndexerId(store),
    ...normalized,
    createdAt: new Date().toISOString(),
  });

  if (dryRun) {
    return { action: "indexer-memory", entry, dryRun: true };
  }

  store.entries.push(entry);
  saveIndexerMemory(store);
  return { action: "indexer-memory", entry, canonicalLocation: INDEXER_MEMORY_PATH };
}

/** @param {ReturnType<typeof normalizeIngestInput>} normalized */
export function buildGotchaProposal(normalized) {
  const idBase = (normalized.triggerTerms[0] ?? normalized.summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return {
    id: idBase || "new-trigger",
    match: normalized.triggerTerms.length > 0 ? normalized.triggerTerms : [normalized.summary.slice(0, 40)],
    orchestratorSteps: normalized.type?.includes("ui") ? [6, 7] : [6],
    dossierTags: normalized.tags.filter((t) => !t.includes("/")),
    files: normalized.relatedFiles ?? [],
    rules: [],
    commands: normalized.slice
      ? [`# slice ${normalized.slice.file}:${normalized.slice.startLine}-${normalized.slice.endLine}`]
      : [],
    _proposalNote: normalized.summary,
  };
}

/** @param {ReturnType<typeof buildGotchaProposal>} proposal */
export function appendGotchaTrigger(proposal) {
  const map = loadGotchaMap();
  if (map.triggers.some((t) => t.id === proposal.id)) {
    throw new Error(`gotcha-map: trigger id already exists: ${proposal.id}`);
  }
  const { _proposalNote, ...trigger } = proposal;
  map.triggers.push(trigger);
  writeJson(GOTCHA_MAP_PATH, map);
  return trigger;
}

/** @param {string} query @param {string} phrase */
function phraseMatches(query, phrase) {
  const q = query.toLowerCase();
  const p = phrase.toLowerCase();
  if (q.includes(p) || p.includes(q)) return true;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const pTokens = p.split(/\s+/).filter(Boolean);
  if (pTokens.length > 1) return false;
  return pTokens.some((t) => t.length >= 3 && qTokens.some((qt) => qt.includes(t) || t.includes(qt)));
}

/**
 * Deterministic retrieval — trigger term match + optional type/subtype gate.
 * @param {string} taskQuery title + scope
 * @param {string | null} typeKey e.g. service-logic/indexer
 * @param {IndexerMemoryEntry[]} [entries]
 */
export function matchIndexerMemory(taskQuery, typeKey, entries) {
  const list = entries ?? loadIndexerMemory().entries ?? [];
  const slash = typeKey?.indexOf("/") ?? -1;
  const taskType = slash >= 0 ? typeKey.slice(0, slash) : typeKey ?? "";
  const taskSubtype = slash >= 0 ? typeKey.slice(slash + 1) : "";

  return list
    .filter((entry) => entry.injectBeforeWork !== false)
    .map((entry) => {
      let score = 0;
      for (const term of entry.triggerTerms ?? []) {
        if (phraseMatches(taskQuery, term)) {
          score += term.split(/\s+/).length;
        }
      }
      if (score === 0) return { entry, score: 0 };

      if (entry.type) {
        if (taskType && entry.type !== taskType) return { entry, score: 0 };
        if (entry.subtype && taskSubtype && entry.subtype !== taskSubtype) {
          return { entry, score: 0 };
        }
        score += 2;
      }
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ entry }) => entry);
}

/** @param {IndexerMemoryEntry} entry */
export function sliceIndexerEntry(entry) {
  if (!entry.slice?.file) {
    return {
      id: entry.id,
      category: entry.category,
      summary: entry.summary,
      excerpt: null,
      slice: null,
    };
  }
  const filePath = path.join(REPO_ROOT, entry.slice.file);
  if (!fs.existsSync(filePath)) {
    return {
      id: entry.id,
      category: entry.category,
      summary: entry.summary,
      excerpt: null,
      slice: entry.slice,
      error: `missing file ${entry.slice.file}`,
    };
  }
  const lines = readText(filePath).split("\n");
  const { startLine, endLine } = entry.slice;
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    return {
      id: entry.id,
      category: entry.category,
      summary: entry.summary,
      excerpt: null,
      slice: entry.slice,
      error: `stale range ${startLine}-${endLine} for ${entry.slice.file} (${lines.length} lines)`,
    };
  }
  return {
    id: entry.id,
    category: entry.category,
    summary: entry.summary,
    file: entry.slice.file,
    startLine,
    endLine,
    excerpt: lines.slice(startLine - 1, endLine).join("\n"),
    slice: entry.slice,
    confidence: entry.confidence,
    sourceTask: entry.sourceTask,
    promotionCandidate: entry.promotionCandidate ?? false,
  };
}

/**
 * @param {string} taskQuery
 * @param {string | null} typeKey
 */
export function buildIndexerMemoryResult(taskQuery, typeKey) {
  const matched = matchIndexerMemory(taskQuery, typeKey);
  return {
    task: taskQuery,
    typeKey,
    matchedIds: matched.map((e) => e.id),
    entries: matched.map((e) => sliceIndexerEntry(e)),
  };
}

/** @param {ReturnType<typeof buildIndexerMemoryResult>} result */
export function renderIndexerMemoryMarkdown(result) {
  const lines = ["## Indexer memory (deterministic)", ""];
  if (result.entries.length === 0) {
    lines.push("No indexer-memory matches for task + type/subtype.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`Matched: ${result.matchedIds.join(", ")}`);
  lines.push("");
  for (const entry of result.entries) {
    lines.push(`### ${entry.id} — ${entry.category}`);
    lines.push(`- ${entry.summary}`);
    if (entry.error) {
      lines.push(`- WARN: ${entry.error}`);
    } else if (entry.excerpt) {
      lines.push(`- Slice: ${entry.file}:${entry.startLine}-${entry.endLine}`);
      lines.push("");
      lines.push(entry.excerpt);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** @param {IndexerMemoryEntry} entry */
export function validateIndexerMemorySlice(entry) {
  if (!entry.slice?.file) return [];
  const { file, startLine, endLine, anchor } = entry.slice;
  const label = entry.id ?? "?";
  const filePath = path.join(REPO_ROOT, file);
  /** @type {string[]} */
  const issues = [];
  if (!fs.existsSync(filePath)) {
    issues.push(`indexer-memory: ${label} slice file missing ${file}`);
    return issues;
  }
  const lineCount = readText(filePath).split("\n").length;
  if (startLine === 1 && endLine >= lineCount - 1) {
    issues.push(
      `indexer-memory: ${label} full-file slice reference (${file}:1-${endLine})`,
    );
  }
  for (const msg of validateEntryRange({
    id: entry.id,
    tags: entry.tags ?? [],
    title: entry.summary,
    file,
    startLine,
    endLine,
    anchor,
  })) {
    issues.push(`indexer-memory: ${label} ${msg}`);
  }
  return issues;
}

/** @param {IndexerMemoryStore} store */
export function validateIndexerMemorySlices(store) {
  /** @type {string[]} */
  const issues = [];
  for (const entry of store.entries ?? []) {
    issues.push(...validateIndexerMemorySlice(entry));
  }
  return issues;
}

/** Patterns in away:ship --note that auto-trigger learning capture (bonus to explicit --learned). */
export const SHIP_NOTE_LEARNING_SIGNALS = [
  { pattern: /root cause\s*:/i, category: "repeated failure" },
  { pattern: /fix\s*:/i, category: "lesson" },
  { pattern: /prod verify fail/i, category: "gotcha", gateCandidate: true },
  { pattern: /stale gh-pages|gh-pages stale|bundle stale|stale bundle/i, category: "gotcha", gateCandidate: true },
  { pattern: /local pass.*prod fail|prod-only/i, category: "gotcha", gateCandidate: true },
  { pattern: /failed twice|2nd fail|second fail|regression/i, category: "repeated failure" },
  { pattern: /security finding|HIGH risk|security gate/i, category: "lesson" },
];

/**
 * @param {string | undefined} note
 * @param {{ learned?: string, failure?: string, fix?: string, skipLearning?: string }} args
 */
export function shouldCaptureShipLearning(note, args = {}) {
  if (args.skipLearning === "true") return false;
  if (args.learned?.trim() || args.failure?.trim() || args.fix?.trim()) return true;
  if (!note?.trim()) return false;
  return SHIP_NOTE_LEARNING_SIGNALS.some(({ pattern }) => pattern.test(note));
}

/**
 * @param {string | undefined} note
 */
export function detectShipNoteLearningCategory(note) {
  if (!note?.trim()) return null;
  for (const signal of SHIP_NOTE_LEARNING_SIGNALS) {
    if (signal.pattern.test(note)) return signal.category;
  }
  return null;
}

/**
 * @param {string} summary
 * @param {Record<string, unknown> | null | undefined} item
 * @param {string | undefined} explicitTrigger
 */
export function deriveShipLearningTriggerTerms(summary, item, explicitTrigger) {
  if (explicitTrigger?.trim()) {
    return explicitTrigger
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  /** @type {Set<string>} */
  const terms = new Set();
  const type = typeof item?.type === "string" ? item.type.trim() : "";
  const subtype = typeof item?.subtype === "string" ? item.subtype.trim() : "";
  if (type) terms.add(type);
  if (subtype) terms.add(subtype);
  const title = typeof item?.title === "string" ? item.title.trim() : "";
  for (const word of `${title} ${summary}`.split(/\s+/)) {
    const w = word.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (w.length >= 4 && !/^(this|that|with|from|when|then|have|been|only|after|before|ship|task)$/.test(w)) {
      terms.add(w);
    }
  }
  if (terms.size === 0) terms.add("away-ship-learning");
  return [...terms].slice(0, 8);
}

/**
 * Build ingest input from away:ship flags + queue item metadata.
 * @param {Record<string, string>} args away:ship CLI args
 * @param {Record<string, unknown> | null | undefined} item queue item
 */
export function buildShipLearningInput(args, item) {
  /** @type {Record<string, unknown>} */
  const input = {};

  if (args.learned?.trim()) {
    input.summary = args.learned.trim();
  } else if (args.failure?.trim() || args.fix?.trim()) {
    const failure = args.failure?.trim() ?? "";
    const fix = args.fix?.trim() ?? "";
    input.summary = failure && fix ? `${failure} Fix: ${fix}` : failure || fix;
  } else if (args.note?.trim()) {
    input.summary = args.note.trim().slice(0, 280);
  } else {
    throw new Error("ship learning: no summary from --learned, --failure/--fix, or --note");
  }

  if (args.category?.trim()) input.category = args.category.trim();
  else if (args.note?.trim()) {
    const inferred = detectShipNoteLearningCategory(args.note);
    if (inferred) input.category = inferred;
  }

  input.sourceTask = args.id ?? null;
  input.sourceCommit = args.commit ?? null;

  if (args.type?.trim()) input.type = args.type.trim();
  else if (typeof item?.type === "string" && item.type.trim()) input.type = item.type.trim();

  if (args.subtype?.trim()) input.subtype = args.subtype.trim();
  else if (typeof item?.subtype === "string" && item.subtype.trim()) input.subtype = item.subtype.trim();

  input.triggerTerms = deriveShipLearningTriggerTerms(String(input.summary), item, args.trigger);

  if (args.tags?.trim()) {
    input.tags = args.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  if (args.gate === "true" || args.gateCandidate === "true") {
    input.gateCandidate = true;
  } else if (args.note?.trim()) {
    const gateSignal = SHIP_NOTE_LEARNING_SIGNALS.find(
      (s) => s.gateCandidate && s.pattern.test(args.note),
    );
    if (gateSignal) input.gateCandidate = true;
  }

  if (input.gateCandidate === true && !input.notes) {
    input.notes = String(input.summary);
  }

  return input;
}

/**
 * Auto-capture learning on away:ship — SSOT for worker hard-earned fixes.
 * @param {Record<string, string>} args away:ship CLI args
 * @param {Record<string, unknown> | null | undefined} item queue item
 * @param {{ dryRun?: boolean }} [opts]
 */
export function captureLearningFromShip(args, item, opts = {}) {
  if (!shouldCaptureShipLearning(args.note, args)) return null;
  const input = buildShipLearningInput(args, item);
  const normalized = normalizeIngestInput(input);
  const typeKey =
    normalized.type && normalized.subtype
      ? `${normalized.type}/${normalized.subtype}`
      : normalized.type ?? undefined;
  return ingestIndexerEntry(normalized, { dryRun: opts.dryRun ?? false, typeKey });
}

/**
 * Collect gateCandidate warnings from matched indexer-memory entries.
 * @param {string} taskQuery
 * @param {string | null} typeKey
 * @param {IndexerMemoryEntry[]} [entries]
 */
export function collectIndexerGateWarnings(taskQuery, typeKey, entries) {
  const matched = matchIndexerMemory(taskQuery, typeKey, entries);
  return matched
    .filter((entry) => entry.gateCandidate === true)
    .map((entry) => entry.notes?.trim() || entry.summary)
    .filter(Boolean);
}

/**
 * Merge gotcha + indexer gate warnings without near-duplicates.
 * @param {string[]} gotchaWarnings
 * @param {string[]} indexerWarnings
 */
export function mergeGateWarnings(gotchaWarnings, indexerWarnings) {
  /** @type {string[]} */
  const merged = [...gotchaWarnings];
  for (const warning of indexerWarnings) {
    const lower = warning.toLowerCase();
    if (merged.some((existing) => existing.toLowerCase().includes(lower) || lower.includes(existing.toLowerCase()))) {
      continue;
    }
    merged.push(warning);
  }
  return merged;
}

/** @param {IndexerMemoryStore} store */
export function validateIndexerMemory(store) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!Array.isArray(store.entries)) {
    errors.push("indexer-memory: entries must be an array");
    return { errors, warnings };
  }

  const ids = new Set();
  /** @type {Map<string, string>} */
  const gotchaTermOwners = new Map();

  let gotchaMap;
  try {
    gotchaMap = loadGotchaMap();
    for (const trigger of gotchaMap.triggers ?? []) {
      for (const term of trigger.match ?? []) {
        gotchaTermOwners.set(term.toLowerCase(), trigger.id);
      }
    }
  } catch {
    warnings.push("indexer-memory: could not load gotcha-map for duplicate check");
  }

  for (const entry of store.entries) {
    const label = entry.id ?? "?";

    if (!entry.id) errors.push("indexer-memory: entry missing id");
    else if (ids.has(entry.id)) errors.push(`indexer-memory: duplicate id ${entry.id}`);
    else ids.add(entry.id);

    if (!entry.summary?.trim()) errors.push(`indexer-memory: ${label} missing summary`);
    if (!entry.category) errors.push(`indexer-memory: ${label} missing category`);
    else if (!INDEXER_CATEGORIES.includes(entry.category)) {
      warnings.push(`indexer-memory: ${label} unknown category ${entry.category}`);
    }

    if (entry.injectBeforeWork !== false) {
      if (!Array.isArray(entry.triggerTerms) || entry.triggerTerms.length === 0) {
        errors.push(`indexer-memory: ${label} injectBeforeWork but missing triggerTerms`);
      }
      if (entry.injectBeforeWork && !entry.type) {
        errors.push(`indexer-memory: ${label} injectBeforeWork but missing type`);
      }
      if (entry.injectBeforeWork && entry.type && !entry.subtype) {
        warnings.push(`indexer-memory: ${label} injectBeforeWork with type but missing subtype`);
      }
      if (entry.injectBeforeWork && !entry.slice?.file && !entry.notes?.trim()) {
        warnings.push(
          `indexer-memory: ${label} injectBeforeWork without slice — add slice ref or notes for packet injection`,
        );
      }
    }

    if (entry.gateCandidate === true && !entry.promotionCandidate) {
      warnings.push(
        `indexer-memory: ${label} gateCandidate set — promote to gotcha-map via --apply-gotcha when ready`,
      );
    }

    const isVerifyFailure =
      (entry.tags ?? []).includes("verify-failure") ||
      (entry.tags ?? []).includes("verify-auto-capture");
    if (isVerifyFailure) {
      if (!entry.type?.trim()) {
        errors.push(`indexer-memory: ${label} verify-failure entry missing type`);
      }
      if (!entry.subtype?.trim()) {
        errors.push(`indexer-memory: ${label} verify-failure entry missing subtype`);
      }
      if (entry.gateCandidate === true && entry.type === "backend-write-critical") {
        errors.push(
          `indexer-memory: ${label} verify-failure gateCandidate on backend-write-critical — stale gh-pages leak risk`,
        );
      }
    }

    for (const term of entry.triggerTerms ?? []) {
      const owner = gotchaTermOwners.get(term.toLowerCase());
      if (owner && entry.category === "gotcha") {
        errors.push(
          `indexer-memory: ${label} duplicate gotcha trigger term "${term}" (already in gotcha-map:${owner})`,
        );
      } else if (owner && entry.promotionCandidate) {
        warnings.push(
          `indexer-memory: ${label} promotion term "${term}" overlaps gotcha-map:${owner}`,
        );
      }
    }

    if (
      entry.canonicalLocation?.includes("LIBRARIAN_LESSONS") &&
      entry.category !== "lesson"
    ) {
      warnings.push(
        `indexer-memory: ${label} points at LIBRARIAN_LESSONS SSOT but category is ${entry.category} — use reference only`,
      );
    }
  }

  return { errors, warnings };
}
