/**
 * Context Packet Builder lite — hot tier + dossier § slices + optional queue head.
 */
import {
  PATHS,
  blockersOneLiner,
  buildNextBrief,
  firstRunnableItem,
  parseBlockersFromCurrentState,
  parseImmediateNextFromCurrentState,
  parseLastShippedFromCurrentState,
  readJson,
  readText,
} from "./away-memory-lib.mjs";
import {
  findByTag,
  findSectionByTag,
  loadContextIndex,
  loadDossierIndex,
  sliceEntry,
} from "./dossier-index-lib.mjs";
import {
  buildGotchaResult,
  buildLessonsSliceForTypeKey,
  loadGotchaMap,
  matchTriggers,
  renderGotchaMarkdown,
} from "./gotcha-map-lib.mjs";
import {
  buildIndexerMemoryResult,
  collectIndexerGateWarnings,
  mergeGateWarnings,
  renderIndexerMemoryMarkdown,
} from "./indexer-ingest-lib.mjs";
import { collectPendingLearningGateWarnings } from "./verify-learning-hook.mjs";
import { renderLessonsSliceMarkdown } from "./librarian-lessons-lib.mjs";

/**
 * @param {string[]} tags
 * @returns {{ tag: string, id: string, file: string, startLine: number, endLine: number, title: string, excerpt: string }[]}
 */
export function buildDossierSlicesForTags(tags) {
  const dossierIndex = loadDossierIndex();
  const contextIndex = loadContextIndex();
  const sections = contextIndex.sections ?? [];
  /** @type {Map<string, { tag: string, id: string, file: string, startLine: number, endLine: number, title: string, excerpt: string }>} */
  const byId = new Map();

  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    const dossierEntry = findByTag(dossierIndex, trimmed);
    if (dossierEntry && !byId.has(dossierEntry.id)) {
      byId.set(dossierEntry.id, {
        tag: trimmed,
        id: dossierEntry.id,
        file: dossierEntry.file,
        startLine: dossierEntry.startLine,
        endLine: dossierEntry.endLine,
        title: dossierEntry.title,
        excerpt: sliceEntry(dossierEntry),
      });
      continue;
    }

    const sectionEntry = findSectionByTag(sections, trimmed);
    if (sectionEntry && !byId.has(sectionEntry.id)) {
      byId.set(sectionEntry.id, {
        tag: trimmed,
        id: sectionEntry.id,
        file: sectionEntry.file,
        startLine: sectionEntry.startLine,
        endLine: sectionEntry.endLine,
        title: sectionEntry.title ?? sectionEntry.id,
        excerpt: sliceEntry(sectionEntry),
      });
    }
  }

  return [...byId.values()];
}

/** @param {Record<string, unknown>} item */
function buildTaskQueryFromItem(item) {
  /** @type {string[]} */
  const parts = [];
  if (typeof item.title === "string" && item.title.trim()) parts.push(item.title.trim());
  if (typeof item.scope === "string" && item.scope.trim()) parts.push(item.scope.trim());
  return parts.join(" ");
}

/** @param {Record<string, unknown>} item @returns {string | null} */
function resolveTypeKeyFromItem(item) {
  const type = typeof item.type === "string" ? item.type.trim() : "";
  const subtype = typeof item.subtype === "string" ? item.subtype.trim() : "";
  if (!type) return null;
  return subtype ? `${type}/${subtype}` : type;
}

/** @param {Record<string, unknown>} item */
function buildGotchaForItem(item) {
  const task = buildTaskQueryFromItem(item);
  const typeKey = resolveTypeKeyFromItem(item);
  const map = loadGotchaMap();
  const matched = matchTriggers(task, map.triggers ?? []);
  /** @type {Record<string, unknown>} */
  const gotcha = {
    task,
    ...buildGotchaResult(matched, map.orchestratorSteps ?? {}),
  };
  const indexerGateWarnings = collectIndexerGateWarnings(task, typeKey);
  const pendingGateWarnings = collectPendingLearningGateWarnings(task, typeKey);
  gotcha.gateWarnings = mergeGateWarnings(
    mergeGateWarnings(
      /** @type {string[]} */ (gotcha.gateWarnings ?? []),
      indexerGateWarnings,
    ),
    pendingGateWarnings,
  );
  if (matched.length === 0) {
    gotcha.fallback = {
      message: "No gotcha trigger match — use hot tier only (CURRENT_STATE.md + MEMORY.md)",
      hotTier: ["PROJECT_STATUS/CURRENT_STATE.md", "PROJECT_STATUS/MEMORY.md"],
    };
  }
  return gotcha;
}

/** @param {Record<string, unknown>} item */
function buildLessonsSliceForItem(item) {
  const typeKey = resolveTypeKeyFromItem(item);
  if (!typeKey) return null;
  return buildLessonsSliceForTypeKey(typeKey);
}

/**
 * Skip indexer when gotcha + type/subtype lessons slice already cover the same lessons §.
 * @param {Record<string, unknown>} gotcha
 * @param {Record<string, unknown> | null} lessonsSlice
 */
function indexerDomainCoveredByGotchaAndLessons(gotcha, lessonsSlice) {
  const gotchaMatched = Array.isArray(gotcha.matchedTriggers) && gotcha.matchedTriggers.length > 0;
  if (!gotchaMatched || !lessonsSlice || lessonsSlice.found !== true) return false;

  const lessonSectionId =
    typeof lessonsSlice.sectionId === "string" ? lessonsSlice.sectionId : null;
  if (!lessonSectionId) return false;

  const gotchaSections = /** @type {{ sectionId?: string, found?: boolean }[]} */ (
    gotcha.lessonsSlices ?? []
  );
  return gotchaSections.some((slice) => slice.found && slice.sectionId === lessonSectionId);
}

/** @param {Record<string, unknown>} item */
function buildIndexerMemoryForItem(item, gotcha, lessonsSlice) {
  if (indexerDomainCoveredByGotchaAndLessons(gotcha, lessonsSlice)) {
    return { task: buildTaskQueryFromItem(item), typeKey: resolveTypeKeyFromItem(item), matchedIds: [], entries: [], skipped: "gotcha+lessons cover domain" };
  }
  const task = buildTaskQueryFromItem(item);
  const typeKey = resolveTypeKeyFromItem(item);
  return buildIndexerMemoryResult(task, typeKey);
}

/**
 * @param {{ tags?: string[], includeQueue?: boolean, list?: { queue: object[], executionProtocol?: object }, archive?: { items?: object[] } }} [opts]
 */
export function buildContextPacket(opts = {}) {
  const tags = opts.tags ?? [];
  const includeQueue = opts.includeQueue ?? false;
  const currentStateMd = readText(PATHS.currentState);
  const blockers = parseBlockersFromCurrentState(currentStateMd);

  /** @type {Record<string, unknown>} */
  const packet = {
    hotTier: {
      files: ["PROJECT_STATUS/CURRENT_STATE.md", "PROJECT_STATUS/MEMORY.md"],
      blockers,
      blockersOneLiner: blockersOneLiner(blockers),
      snapshot: {
        lastShipped: parseLastShippedFromCurrentState(currentStateMd),
        immediateNext: parseImmediateNextFromCurrentState(currentStateMd),
      },
    },
    dossierSlices: buildDossierSlicesForTags(tags),
  };

  if (includeQueue) {
    const list = opts.list ?? readJson(PATHS.awayList);
    const archive = opts.archive ?? readJson(PATHS.awayArchive);
    const next = firstRunnableItem(list.queue, archive);
    packet.queue = next
      ? { id: next.id, title: next.title, dependsOn: next.dependsOn ?? null }
      : { queued: false, message: "No runnable queued item." };
  }

  return packet;
}

/**
 * @param {{ tags?: string[], list?: object, archive?: object }} opts
 */
export function buildAwayNextPacket(opts = {}) {
  const tags = opts.tags ?? [];
  const list = opts.list ?? readJson(PATHS.awayList);
  const archive = opts.archive ?? readJson(PATHS.awayArchive);
  const next = firstRunnableItem(list.queue, archive);

  if (!next) {
    return {
      queued: false,
      message: "No runnable queued item.",
      packet: buildContextPacket({ tags, includeQueue: false }),
    };
  }

  const brief = buildNextBrief(next);
  const packet = buildContextPacket({ tags, includeQueue: false });
  const gotcha = buildGotchaForItem(next);
  const lessonsSlice = buildLessonsSliceForItem(next);
  const indexerMemory = buildIndexerMemoryForItem(next, gotcha, lessonsSlice);
  const gateWarnings = /** @type {string[]} */ (gotcha.gateWarnings ?? []);
  const injectBeforeHints = /** @type {string[]} */ (gotcha.injectBeforeHints ?? []);

  /** @type {Record<string, unknown>} */
  const executionPacket = {
    hotTier: packet.hotTier,
    dossierSlices: packet.dossierSlices,
    gotcha,
  };
  if (gateWarnings.length > 0) executionPacket.gateWarnings = gateWarnings;
  if (injectBeforeHints.length > 0) executionPacket.injectBeforeHints = injectBeforeHints;
  if (lessonsSlice) executionPacket.lessonsSlice = lessonsSlice;
  if (indexerMemory.entries.length > 0) executionPacket.indexerMemory = indexerMemory;

  return {
    ...brief,
    packet: executionPacket,
  };
}

/** @param {Record<string, unknown>} packet */
export function renderPacketMarkdown(packet) {
  const lines = ["# Context packet", ""];

  const hotTier = /** @type {{ files?: string[], blockersOneLiner?: string, snapshot?: { lastShipped?: string | null, immediateNext?: string | null } }} */ (
    packet.hotTier ?? {}
  );
  lines.push("## Hot tier");
  for (const file of hotTier.files ?? []) {
    lines.push(`- ${file}`);
  }
  if (hotTier.blockersOneLiner) {
    lines.push(`- Blockers: ${hotTier.blockersOneLiner}`);
  }
  if (hotTier.snapshot) {
    if (hotTier.snapshot.lastShipped) lines.push(`- Last shipped: ${hotTier.snapshot.lastShipped}`);
    if (hotTier.snapshot.immediateNext) lines.push(`- Immediate next: ${hotTier.snapshot.immediateNext}`);
  }
  lines.push("");

  const queue = /** @type {{ id?: string, title?: string, dependsOn?: string | null, queued?: boolean, message?: string } | undefined} */ (
    packet.queue
  );
  if (queue) {
    lines.push("## Queue head");
    if (queue.id) {
      lines.push(`- **${queue.id}** — ${queue.title}`);
      if (queue.dependsOn) lines.push(`- dependsOn: ${queue.dependsOn}`);
    } else {
      lines.push(`- ${queue.message ?? "No queue head"}`);
    }
    lines.push("");
  }

  const slices = /** @type {{ tag: string, id: string, file: string, startLine: number, endLine: number, title: string, excerpt: string }[]} */ (
    packet.dossierSlices ?? []
  );
  if (slices.length > 0) {
    lines.push("## Dossier slices");
    for (const slice of slices) {
      lines.push(`### ${slice.tag} → ${slice.id} (${slice.file}:${slice.startLine}-${slice.endLine})`);
      lines.push("");
      lines.push(slice.excerpt);
      lines.push("");
    }
  }

  const gotcha = /** @type {Record<string, unknown> | undefined} */ (packet.gotcha);
  if (gotcha) {
    lines.push(renderGotchaMarkdown(gotcha).trim());
    lines.push("");
  }

  const topGateWarnings = /** @type {string[] | undefined} */ (packet.gateWarnings);
  if (topGateWarnings && topGateWarnings.length > 0 && !gotcha?.gateWarnings) {
    lines.push("## Gate candidate warnings (inject before prod verify / ship)");
    for (const w of topGateWarnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }

  const lessonsSlice = /** @type {Record<string, unknown> | undefined} */ (packet.lessonsSlice);
  if (lessonsSlice) {
    lines.push(renderLessonsSliceMarkdown(lessonsSlice).trim());
    lines.push("");
  }

  const indexerMemory = /** @type {Record<string, unknown> | undefined} */ (packet.indexerMemory);
  if (indexerMemory) {
    lines.push(renderIndexerMemoryMarkdown(indexerMemory).trim());
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

/** @param {Record<string, unknown>} merged */
export function renderAwayNextPacketMarkdown(merged) {
  if (merged.queued === false) {
    return `# Away next packet\n\n${merged.message ?? "No runnable queued item."}\n`;
  }

  const lines = [
    "# Away next packet",
    "",
    `## ${merged.id} — ${merged.title}`,
    "",
    `- Tier: ${merged.tier ?? "—"}`,
    `- dependsOn: ${merged.dependsOn ?? "none"}`,
  ];
  if (merged.scope) lines.push("", "### Scope", "", String(merged.scope));
  if (merged.acceptance) lines.push("", "### Acceptance", "", String(merged.acceptance));

  const packet = /** @type {Record<string, unknown>} */ (merged.packet ?? {});
  lines.push("", renderPacketMarkdown({ ...packet, queue: undefined }).trim());

  return `${lines.join("\n")}\n`;
}
