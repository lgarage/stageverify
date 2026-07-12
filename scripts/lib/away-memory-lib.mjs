/**
 * Shared helpers for away-list / away-status / memory validation.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const PATHS = {
  awayList: path.join(REPO_ROOT, "PROJECT_STATUS/away-list.json"),
  awayStatus: path.join(REPO_ROOT, "PROJECT_STATUS/away-status.json"),
  awayArchive: path.join(REPO_ROOT, "PROJECT_STATUS/archives/away-batch-3.json"),
  currentState: path.join(REPO_ROOT, "PROJECT_STATUS/CURRENT_STATE.md"),
  nextMd: path.join(REPO_ROOT, "NEXT.md"),
  memoryMd: path.join(REPO_ROOT, "PROJECT_STATUS/MEMORY.md"),
  roadmap: path.join(REPO_ROOT, "docs/roadmap.md"),
  projectState: path.join(REPO_ROOT, "docs/project_state.md"),
  locationFirstSpec: path.join(REPO_ROOT, "docs/location-first-transition-spec.md"),
};

/** @param {string} filePath */
export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/** @param {string} filePath */
export function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

/** @param {string} filePath @param {unknown} data */
export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** @param {string} filePath @param {string} text */
export function writeText(filePath, text) {
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

/** @param {string} id */
export function awayIdNum(id) {
  const n = Number.parseInt(id.replace(/^away-/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** @param {{ id: string, status: string, dependsOn?: string }[]} queue @param {{ items?: { id: string, status: string }[] }} [archive] @param {{ id: string, status: string }[]} [statusResults] */
export function firstRunnableItem(queue, archive, statusResults) {
  const byId = new Map(queue.map((item) => [item.id, item]));
  const archived = new Map((archive?.items ?? []).map((item) => [item.id, item]));
  /** @type {{ id: string, status: string }[]} */
  let shipped = statusResults;
  if (!shipped) {
    try {
      const status = readJson(PATHS.awayStatus);
      shipped = status.results ?? [];
    } catch {
      shipped = [];
    }
  }
  const built = new Map(
    shipped.filter((r) => r.status === "built").map((r) => [r.id, { id: r.id, status: "done" }]),
  );

  for (const item of queue) {
    if (item.status !== "queued") continue;
    const dep = item.dependsOn;
    if (!dep) return item;
    const pred = byId.get(dep) ?? archived.get(dep) ?? built.get(dep);
    if (pred && pred.status === "done") return item;
  }
  return null;
}

/** @param {string} md */
export function parseBlockersFromCurrentState(md) {
  const section = md.match(/## Active Blockers\n([\s\S]*?)(?=\n## |$)/);
  if (!section) return [];
  return section[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+\*\*/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, "").replace(/\*\*/g, "").trim());
}

/** @param {string[]} blockers */
export function blockersOneLiner(blockers) {
  if (blockers.length === 0) return "No active blockers.";
  if (blockers.length === 1) return blockers[0];
  const short = blockers.map((b) => b.split(" — ")[0].trim());
  return `${blockers.length} active blockers: ${short.join("; ")}`;
}

/**
 * Parse Last shipped from CURRENT_STATE Snapshot.
 * Accepts **away-NNN** or standalone **title** (standalone <hash>|chore).
 * @param {string} md
 * @returns {{ kind: "away", id: string } | { kind: "standalone", title: string, hash?: string } | null}
 */
export function parseLastShippedFromCurrentState(md) {
  const lineMatch = md.match(/^- Last shipped:\s*(.+)$/m);
  if (!lineMatch) return null;
  const line = lineMatch[1];

  const awayMatch = line.match(/\*\*(away-\d+)\*\*/i);
  if (awayMatch) return { kind: "away", id: awayMatch[1] };

  const standaloneHash = line.match(/\*\*(.+?)\*\*.*\(standalone\s+([a-f0-9]{6,40}|chore)\)/i);
  if (standaloneHash) {
    const hash = standaloneHash[2].toLowerCase();
    return {
      kind: "standalone",
      title: standaloneHash[1].trim(),
      ...(hash !== "chore" ? { hash } : {}),
    };
  }

  const titleOnly = line.match(/\*\*(.+?)\*\*/);
  if (titleOnly && !/\*\*away-\d+\*\*/i.test(line)) {
    return { kind: "standalone", title: titleOnly[1].trim() };
  }

  return null;
}

/** @param {ReturnType<typeof parseLastShippedFromCurrentState>} parsed */
export function formatLastShippedLabel(parsed) {
  if (!parsed) return null;
  if (parsed.kind === "away") return parsed.id;
  if (parsed.hash) return `${parsed.title} (standalone ${parsed.hash})`;
  return `${parsed.title} (standalone)`;
}

/** @param {string} md */
export function parseImmediateNextFromCurrentState(md) {
  const match = md.match(/## Immediate Next Step\n- \*\*(away-\d+)\*\*/);
  return match ? match[1] : null;
}

/** @param {string} md */
export function parseFirstQueuedFromProjectState(md) {
  const match = md.match(/## Immediate Next Steps\n\n1\. \*\*(away-\d+)\*\*/);
  return match ? match[1] : null;
}

/** @param {{ results?: { id: string, status: string }[] }} statusDoc */
export function deriveLastShippedFromStatus(statusDoc) {
  const results = statusDoc.results ?? [];
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r.status === "built" && /^away-\d+$/.test(r.id)) return r.id;
  }
  return null;
}

/** @param {{ id: string, title: string, scope?: string, acceptance?: string, verifyBeforeNext?: string[], tier?: string, dependsOn?: string } | null} next */
export function renderNextMd(next) {
  if (!next) {
    return `# Next

No queued away items. Add work to \`PROJECT_STATUS/away-list.json\` or read \`PROJECT_STATUS/CURRENT_STATE.md\` for product next steps.

Run: \`npm run away:next\`
`;
  }
  return `# Next

**ID:** \`${next.id}\`  
**Title:** ${next.title}

1. Read \`PROJECT_STATUS/MEMORY.md\` → hot-tier router  
2. Read \`PROJECT_STATUS/svscope_simple.md\` only on scope dispute — align to scope §  
3. \`npm run away:next\` — confirm dependsOn satisfied  
4. \`npm run away:preflight\` — optional before coding (runs verifyBeforeNext)  
5. Implement → verify → append timing to \`PROJECT_STATUS/estimate-log.md\` → \`npm run away:ship -- --id ${next.id} --note "<summary>"\`

Run: \`npm run away:next\`
`;
}

/**
 * Normalize executionProtocol so an empty sequence cannot carry stale batch instructions.
 * Mutates list in place. Safe to call before every away-list write.
 * @param {{ executionProtocol?: { sequence?: string[], instructions?: string | null } }} list
 * @returns {{ changed: boolean, changes: string[] }}
 */
export function normalizeExecutionProtocol(list) {
  /** @type {string[]} */
  const changes = [];
  if (!list.executionProtocol || typeof list.executionProtocol !== "object") {
    list.executionProtocol = { sequence: [] };
    changes.push("created executionProtocol");
  }
  const ep = list.executionProtocol;
  if (!Array.isArray(ep.sequence)) {
    ep.sequence = [];
    changes.push("fixed executionProtocol.sequence to array");
  }
  if (ep.sequence.length === 0 && ep.instructions != null && ep.instructions !== "") {
    const preview =
      typeof ep.instructions === "string" && ep.instructions.length > 72
        ? `${ep.instructions.slice(0, 72)}…`
        : String(ep.instructions);
    changes.push(`cleared stale instructions (${preview})`);
    delete ep.instructions;
  }
  return { changed: changes.length > 0, changes };
}

/** Effective batch instructions for read paths (never trust stale file when sequence empty). */
export function effectiveExecutionInstructions(ep) {
  const sequence = ep?.sequence ?? [];
  if (sequence.length === 0) return null;
  return ep?.instructions ?? null;
}

/** @param {{ executionProtocol?: { sequence?: string[], instructions?: string | null } }} list */
export function describeExecutionProtocolFreshness(list) {
  const ep = list.executionProtocol ?? {};
  const sequenceLength = ep.sequence?.length ?? 0;
  const staleInstructions =
    sequenceLength === 0 && ep.instructions != null && ep.instructions !== "";
  const copy = JSON.parse(JSON.stringify(list));
  const { changed, changes } = normalizeExecutionProtocol(copy);
  return {
    ok: !staleInstructions && !changed,
    sequenceLength,
    instructionsCleared: staleInstructions,
    normalizeWouldChange: changed,
    changes,
  };
}

/** @param {{ executionProtocol?: { sequence?: string[] }, queue: { id: string, status: string }[] }} list */
export function allQueuedItemsInSequenceOrder(list) {
  const sequence = list.executionProtocol?.sequence ?? [];
  const queued = list.queue.filter((q) => q.status === "queued");
  const byId = new Map(list.queue.map((q) => [q.id, q]));
  /** @type {typeof list.queue} */
  const ordered = [];
  const seen = new Set();

  for (const id of sequence) {
    const item = byId.get(id);
    if (item?.status === "queued") {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of queued) {
    if (!seen.has(item.id)) ordered.push(item);
  }
  return ordered;
}

/** @param {{ executionProtocol?: { sequence?: string[], haltOnFailure?: boolean, instructions?: string }, queue: { id: string, status: string }[] }} list @param {{ items?: { id: string, status: string }[] }} archive */
export function buildBatchBrief(list, archive) {
  const items = allQueuedItemsInSequenceOrder(list).map((item) => buildNextBrief(item));
  const ep = list.executionProtocol ?? {};
  const batchSize = items.length;
  const minBatchHint = 3;
  const longBatchExpected = true;
  const shortBatch = batchSize > 0 && batchSize < minBatchHint;

  return {
    mode: "batch",
    batchSize,
    longBatchExpected,
    minBatchHint,
    ...(shortBatch
      ? {
          shortBatchWarning: `Only ${batchSize} queued item(s) — Dan prefers long away/sleep batches (≥${minBatchHint}). Suggest adding more items to away-list.json (do not invent IDs).`,
        }
      : {}),
    items,
    protocol: {
      file: "PROJECT_STATUS/AWAY_BUILD_PROTOCOL.md",
      section: "Away / sleep workflow (4 phases)",
      loop: "Run items in sequence order — one at a time, verify+ship between each, halt on fail.",
      haltOnFailure: ep.haltOnFailure ?? true,
      instructions: effectiveExecutionInstructions(ep),
    },
    protocolFreshness: describeExecutionProtocolFreshness(list),
    note:
      "Answer 'what should I build while I'm away/sleep/overnight' from this batch only. Do not widen to unqueued roadmap work. Dan's standing preference: long batch — run all queued items.",
    firstRunnable: firstRunnableItem(list.queue, archive)?.id ?? null,
  };
}

/** @param {Record<string, unknown>} item */
export function itemScopeDispute(item) {
  if (item.scopeDispute === true) return true;
  const scope = typeof item.scope === "string" ? item.scope : "";
  return /scopeDispute\s*:\s*true/i.test(scope) || /\bscope dispute\b/i.test(scope);
}

/** @param {Record<string, unknown>} item */
export function buildNextBrief(item) {
  const scope = typeof item.scope === "string" ? item.scope : "";
  const blockersApply = /Minew ESL and shop map blockers do not apply|ESL\/shop map do not block/i.test(scope)
    ? false
    : true;
  const scopeDispute = itemScopeDispute(item);

  /** @type {string[]} */
  const readFirst = [
    "PROJECT_STATUS/MEMORY.md",
    "PROJECT_STATUS/CURRENT_STATE.md",
    ...(scopeDispute ? ["PROJECT_STATUS/svscope_simple.md (scope dispute)"] : []),
    `PROJECT_STATUS/away-list.json (item ${item.id})`,
  ];

  return {
    id: item.id,
    title: item.title,
    scope: item.scope ?? null,
    acceptance: item.acceptance ?? null,
    tier: item.tier ?? null,
    verifyBeforeNext: item.verifyBeforeNext ?? [],
    dependsOn: item.dependsOn ?? null,
    blockersApply,
    scopeDispute,
    readFirst,
    note:
      "Answer 'what's next to build?' from this object only. Do not infer next work from docs/roadmap.md LATER/NEXT sections.",
  };
}

/** @param {string} md @param {string} id @param {string} title */
export function updateLastShippedInCurrentState(md, id, title) {
  const shippedLine = `- Last shipped: **${id}** — ${title}`;
  if (/Last shipped:/.test(md)) {
    return md.replace(/^- Last shipped:.*$/m, shippedLine);
  }
  return md.replace(/(## Snapshot\n)/, `$1${shippedLine}\n`);
}

/** @param {string} md @param {{ id: string, title: string } | null} nextItem */
export function updateImmediateNextInCurrentState(md, nextItem) {
  const line = nextItem
    ? `- **${nextItem.id}** — ${nextItem.title} (offline; \`npm run away:next\`). ESL/shop map do not block unless scope says otherwise.`
    : `- **Post-queue:** see \`docs/project_state.md\` immediate next steps.`;
  return md.replace(/(## Immediate Next Step\n)- .+\n/m, `$1${line}\n`);
}

/** @param {{ id: string, title: string } | null} nextItem */
export function renderImmediateNextLineInProjectState(nextItem) {
  if (nextItem) {
    const title = nextItem.title.endsWith(".") ? nextItem.title : `${nextItem.title}.`;
    return `1. **${nextItem.id}** — ${title}`;
  }
  return `1. **Post-queue:** see \`docs/roadmap.md\` NOW bucket and \`PROJECT_STATUS/CURRENT_STATE.md\` — refill queue via \`away-list.json\` when ready.`;
}

/** @param {string} md */
export function updateImmediateNextInProjectState(md, nextItem) {
  const line = renderImmediateNextLineInProjectState(nextItem);
  return md.replace(/(## Immediate Next Steps\n\n)1\. .+\n/m, `$1${line}\n`);
}

/**
 * Parse location-first prod-verify gate closure from CURRENT_STATE (hot tier wins).
 * @param {string} md
 * @returns {{ closedThroughPhase: number | null, version: string | null }}
 */
export function parseLocationFirstGateFromCurrentState(md) {
  const closedMatch = md.match(/Phase\s+(\d+)\s+prod\s+verify\s+gate\s+\*\*closed\*\*/i);
  if (!closedMatch) return { closedThroughPhase: null, version: null };
  const versionMatch = md.match(/Phase\s+\d+\s+prod\s+verify\s+gate\s+\*\*closed\*\*\s*\(v([\d.]+)\)/i);
  return {
    closedThroughPhase: Number(closedMatch[1]),
    version: versionMatch?.[1] ?? null,
  };
}

/**
 * Parse § Phase Tracker status column from location-first spec.
 * @param {string} specMd
 * @returns {Map<number, string>}
 */
export function parseLocationFirstPhaseTracker(specMd) {
  /** @type {Map<number, string>} */
  const map = new Map();
  const rowRe = /^\|\s*(\d+)\s*\|[^|\n]+\|\s*`([^`]+)`\s*\|/gm;
  let match = rowRe.exec(specMd);
  while (match) {
    map.set(Number(match[1]), match[2].trim());
    match = rowRe.exec(specMd);
  }
  return map;
}

/**
 * Cross-check location-first living docs vs CURRENT_STATE hot tier.
 * @param {{ currentStateMd: string, specMd: string, roadmapMd: string }} docs
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLocationFirstDocConsistency({ currentStateMd, specMd, roadmapMd }) {
  /** @type {string[]} */
  const errors = [];
  const gate = parseLocationFirstGateFromCurrentState(currentStateMd);
  if (!gate.closedThroughPhase) return { ok: true, errors };

  const tracker = parseLocationFirstPhaseTracker(specMd);
  for (let phase = 1; phase <= gate.closedThroughPhase; phase++) {
    const status = tracker.get(phase);
    if (!status) {
      errors.push(
        `location-first-transition-spec.md: Phase Tracker missing phase ${phase} while CURRENT_STATE declares Phase ${gate.closedThroughPhase} prod verify gate closed`,
      );
      continue;
    }
    if (status !== "complete") {
      errors.push(
        `location-first-transition-spec.md: Phase ${phase} status is \`${status}\` but CURRENT_STATE declares Phase ${gate.closedThroughPhase} prod verify gate closed — set \`complete\` in Phase Tracker`,
      );
    }
  }

  if (gate.closedThroughPhase >= 4 && /Approved next action:\s*Phase\s*4\b/i.test(specMd)) {
    errors.push(
      "location-first-transition-spec.md: Approved next action still Phase 4 while CURRENT_STATE Phase 4 prod verify gate closed — update to Phase 5 (Fable gate)",
    );
  }

  if (gate.closedThroughPhase >= 4 && /\|\s*\*\*4[–-]6\*\*\s*\|\s*⬜\s*Not started/i.test(roadmapMd)) {
    errors.push(
      "docs/roadmap.md: location-first table still shows 4–6 Not started while CURRENT_STATE Phase 4 gate closed — split Phase 4 complete vs 5–6",
    );
  }

  return { ok: errors.length === 0, errors };
}

/** @param {string} md @param {number} phase */
function markPhaseTrackerRowComplete(specMd, phase, completedDate) {
  const statusRe = new RegExp(
    `^(\\|\\s*${phase}\\s*\\|[^\\n]+\\|\\s*)\`(?:in_progress|not_started)\`(\\s*\\|)`,
    "m",
  );
  let next = specMd.replace(statusRe, `$1\`complete\`$2`);
  if (next === specMd) return specMd;
  const completedRe = new RegExp(
    `^(\\|\\s*${phase}\\s*\\|[^\\n]+\\|\\s*\`complete\`\\s*\\|[^|]+\\|\\s*)(—)(\\s*\\|)`,
    "m",
  );
  next = next.replace(completedRe, `$1${completedDate}$3`);
  return next;
}

/**
 * Auto-sync location-first Phase Tracker + roadmap from CURRENT_STATE gate closure.
 * CURRENT_STATE wins — agents never hand-edit tracker/roadmap on phase close.
 * @param {{ currentStateMd: string, specMd: string, roadmapMd: string }} docs
 * @returns {{ changed: boolean, changes: string[], specMd: string, roadmapMd: string }}
 */
export function syncLocationFirstDocsFromCurrentState({ currentStateMd, specMd, roadmapMd }) {
  const gate = parseLocationFirstGateFromCurrentState(currentStateMd);
  if (!gate.closedThroughPhase) {
    return { changed: false, changes: [], specMd, roadmapMd };
  }

  const version = gate.version ?? "0.0.0";
  const closedDate =
    currentStateMd.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? new Date().toISOString().slice(0, 10);
  /** @type {string[]} */
  const changes = [];
  let spec = specMd;
  let roadmap = roadmapMd;
  const closed = gate.closedThroughPhase;
  const nextPhase = closed + 1;

  for (let phase = 1; phase <= closed; phase++) {
    const before = spec;
    spec = markPhaseTrackerRowComplete(spec, phase, closedDate);
    if (spec !== before) changes.push(`spec: Phase ${phase} → complete`);
  }

  if (closed >= 4 && /Approved next action:\s*Phase\s*4\b/i.test(spec)) {
    spec = spec.replace(
      /> \*\*Approved next action:[^\n]+\n/,
      `> **Approved next action: Phase ${nextPhase}** (technician door + pickup v2) — **Fable work-verifier** on Phase ${closed} boundary before implement. Phase ${closed} prod verify gate closed ${closedDate} (\`v${version}\`).\n`,
    );
    changes.push(`spec: Approved next action → Phase ${nextPhase}`);
  }

  const currentPhaseLine = `**Current phase: Phase ${closed} — complete (prod verify gate closed \`v${version}\`). Next action: Phase ${nextPhase} — dispatch Fable work-verifier, then implement per spec.**`;
  if (!spec.includes(`Phase ${closed} — complete (prod verify gate closed`)) {
    spec = spec.replace(/\*\*Current phase:[^\n]+\*\*/, currentPhaseLine);
    changes.push("spec: Current phase line synced");
  }

  if (closed >= 4) {
    if (/\|\s*\*\*4[–-]6\*\*\s*\|\s*⬜\s*Not started/i.test(roadmap)) {
      roadmap = roadmap.replace(
        /\|\s*\*\*4[–-]6\*\*\s*\|\s*⬜\s*Not started[^\n]*\n/,
        `| **4** Vendor exceptions + dispatcher planning | ✅ Complete ${closedDate} (\`v${version}\`) | \`verify:location-phase4\` 15/15 local + prod; release CF + G1 E2E |\n| **5** Technician door + pickup v2 | ⬜ Not started | Fable work-verifier gate; per spec tracker |\n| **6** Management audit | ⬜ Not started | Sonnet-gated; per spec tracker |\n`,
      );
      changes.push("roadmap: split 4–6 → Phase 4 complete");
    } else if (
      !new RegExp(
        `\\|\\s*\\*\\*${closed}\\*\\*[^\\n]+Complete[^\\n]+v${version.replace(/\./g, "\\.")}`,
        "i",
      ).test(roadmap)
    ) {
      const rowRe = new RegExp(
        `(\\|\\s*\\*\\*${closed}\\*\\*[^|]+\\|\\s*)(⬜[^|]+|🔵[^|]*)(\\s*\\|)`,
        "i",
      );
      if (rowRe.test(roadmap)) {
        roadmap = roadmap.replace(
          rowRe,
          `$1✅ Complete ${closedDate} (\`v${version}\`) | \`verify:location-phase4\` 15/15 local + prod$3`,
        );
        changes.push(`roadmap: Phase ${closed} row → Complete`);
      }
    }
  }

  const lastUpdated = `> **Last updated:** ${closedDate} (Location-first Phase ${closed} gate closed — \`v${version}\`)`;
  if (!roadmap.includes(`Phase ${closed} gate closed`)) {
    roadmap = roadmap.replace(/> \*\*Last updated:\*\*[^\n]+/, lastUpdated);
    changes.push("roadmap: last-updated synced");
  }

  return { changed: changes.length > 0, changes, specMd: spec, roadmapMd: roadmap };
}

/** Roadmap patterns that must not regress (Verifier). */
export const ROADMAP_FORBIDDEN = [
  {
    label: "vendor session not started (traceability)",
    pattern:
      /Temporary vendor session \+ configurable expiration \+ server validation \| \*\*Phase 3 Slice 4 — Vendor access hardening\*\* \| ⬜ Not started/,
  },
  {
    label: "shop geofence not started (traceability)",
    pattern: /Shop geofence as additional vendor control \| \*\*Phase 3 Slice 4 — Vendor access hardening\*\* \| ⬜ Not started/,
  },
  {
    label: "pickup token not built (traceability)",
    pattern:
      /Opaque, unguessable, revocable, server-validated \*\*pickup token\*\* \| \*\*Phase 3 Slice 5 — Pickup link security\*\* \| ⬜ Not built/,
  },
  {
    label: "do not start Phase 4 (narrative)",
    pattern: /Do not start Phase 4 until Phase 3 gate passes/,
  },
  {
    label: "Slice 1 follow-ons still open (narrative)",
    pattern:
      /\*\*Not in Slice 1 \/ still Phase 3:\*\* expected-materials UI, shop-stock pull states, readiness-aware queue/,
  },
  {
    label: "Phase 3 gate requires Slices 4–6 not done (narrative)",
    pattern: /full gate requires Slices 4–6 completion/,
  },
  {
    label: "Phase 5–9 blocked until 3–4 stable without queue override note",
    pattern:
      /Phases 5–9 are sequenced here for prioritization; not started until Phases 3–4 are stable\. Historical/,
  },
  {
    label: "Slice 4 section not started",
    pattern: /### Phase 3 Slice 4 — Vendor access hardening \(not started\)/,
  },
  {
    label: "Slice 5 section not started",
    pattern: /### Phase 3 Slice 5 — Pickup link security \(not started\)/,
  },
  {
    label: "location-first 4-6 not started when Phase 4 closed",
    pattern: /\|\s*\*\*4[–-]6\*\*\s*\|\s*⬜\s*Not started \| Vendor exceptions/,
  },
];
