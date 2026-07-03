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

/** @param {string} md */
export function parseLastShippedFromCurrentState(md) {
  const match = md.match(/Last shipped:\s*\*\*(away-\d+)\*\*/i);
  return match ? match[1] : null;
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
5. Implement → verify → \`npm run away:ship -- --id ${next.id} --note "..."\`

Run: \`npm run away:next\`
`;
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
      instructions: ep.instructions ?? null,
    },
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

/** @param {string} md @param {{ id: string, title: string } | null} nextItem */
export function updateImmediateNextInProjectState(md, nextItem) {
  const line = renderImmediateNextLineInProjectState(nextItem);
  return md.replace(/(## Immediate Next Steps\n\n)1\. .+\n/m, `$1${line}\n`);
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
];
