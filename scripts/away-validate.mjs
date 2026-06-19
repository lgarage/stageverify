#!/usr/bin/env node
/**
 * Cross-file memory consistency checks (Verifier).
 * Run: npm run away:validate
 */
import path from "node:path";
import {
  PATHS,
  REPO_ROOT,
  ROADMAP_FORBIDDEN,
  deriveLastShippedFromStatus,
  firstRunnableItem,
  parseFirstQueuedFromProjectState,
  parseImmediateNextFromCurrentState,
  parseLastShippedFromCurrentState,
  readJson,
  readText,
  renderNextMd,
  writeText,
} from "./lib/away-memory-lib.mjs";

const errors = [];
const warnings = [];

/** @param {string} msg */
function fail(msg) {
  errors.push(msg);
}

/** @param {string} msg */
function warn(msg) {
  warnings.push(msg);
}

function validateAwayList() {
  const list = readJson(PATHS.awayList);
  if (!list.executionProtocol || !Array.isArray(list.queue)) {
    fail("away-list.json: missing executionProtocol or queue");
    return null;
  }

  const ids = new Set();
  for (const item of list.queue) {
    if (!item.id || !item.title || !item.status) {
      fail(`away-list.json: item missing id/title/status: ${JSON.stringify(item?.id)}`);
      continue;
    }
    if (ids.has(item.id)) fail(`away-list.json: duplicate id ${item.id}`);
    ids.add(item.id);

    if (!["queued", "done", "blocked"].includes(item.status)) {
      fail(`away-list.json: ${item.id} invalid status ${item.status}`);
    }

    if (item.status === "done") {
      fail(`away-list.json: ${item.id} is done in active queue — remove or archive (active queue: queued/blocked only)`);
    }

    if (item.dependsOn && item.status === "queued") {
      const sequence = list.executionProtocol?.sequence ?? [];
      const pred = list.queue.find((q) => q.id === item.dependsOn);
      if (pred) {
        if (pred.status === "done") {
          // ok
        } else if (pred.status === "queued") {
          const predIdx = sequence.indexOf(item.dependsOn);
          const itemIdx = sequence.indexOf(item.id);
          if (predIdx < 0 || itemIdx < 0 || predIdx >= itemIdx) {
            fail(
              `away-list.json: ${item.id} dependsOn ${item.dependsOn} but queued predecessor is not earlier in sequence`,
            );
          }
        } else {
          fail(`away-list.json: ${item.id} dependsOn ${item.dependsOn} but predecessor is ${pred.status}`);
        }
      } else {
        const archive = readJson(PATHS.awayArchive);
        const archived = archive.items?.find((a) => a.id === item.dependsOn);
        const statusDoc = readJson(PATHS.awayStatus);
        const shipped = statusDoc.results?.find(
          (r) => r.id === item.dependsOn && r.status === "built",
        );
        if (archived?.status === "done" || shipped) {
          // ok — predecessor archived or shipped this batch
        } else {
          fail(
            `away-list.json: ${item.id} dependsOn ${item.dependsOn} — not done in queue, archive, or away-status (status=${archived?.status ?? shipped?.status ?? "missing"})`,
          );
        }
      }
    }
  }

  const sequence = list.executionProtocol.sequence;
  if (!Array.isArray(sequence)) {
    fail("away-list.json: executionProtocol.sequence must be an array");
  } else {
    for (const id of sequence) {
      if (!list.queue.some((q) => q.id === id)) {
        fail(`away-list.json: sequence references ${id} not in active queue`);
      }
    }
  }

  return list;
}

function validateAwayStatus(list) {
  const status = readJson(PATHS.awayStatus);
  if (!Array.isArray(status.results)) {
    fail("away-status.json: results must be an array");
    return status;
  }

  const statusById = new Map(status.results.map((r) => [r.id, r]));

  for (const item of list.queue) {
    if (item.status !== "queued") continue;
    const row = statusById.get(item.id);
    if (row && row.status === "built") {
      fail(`drift: ${item.id} is queued in away-list but built in away-status — run away:ship or fix manually`);
    }
  }

  return status;
}

function validateArchive() {
  if (!readText(PATHS.awayArchive).trim()) {
    fail("archives/away-batch-3.json missing or empty");
    return;
  }
  const archive = readJson(PATHS.awayArchive);
  if (!Array.isArray(archive.items) || archive.items.length < 41) {
    fail(`archives/away-batch-3.json: expected ≥41 archived items, got ${archive.items?.length ?? 0}`);
  }
}

function validateNextIdSync(list, archive, statusDoc) {
  const next = firstRunnableItem(list.queue, archive);
  const nextId = next?.id ?? null;

  const currentState = readText(PATHS.currentState);
  const immediate = parseImmediateNextFromCurrentState(currentState);
  const projectFirst = parseFirstQueuedFromProjectState(readText(PATHS.projectState));
  const nextMd = readText(PATHS.nextMd);

  if (nextId) {
    if (immediate !== nextId) {
      fail(`CURRENT_STATE immediate next (${immediate ?? "missing"}) !== queue head (${nextId})`);
    }
    if (projectFirst !== nextId) {
      fail(`project_state.md item #1 (${projectFirst ?? "missing"}) !== queue head (${nextId})`);
    }
    if (!nextMd.includes(nextId)) {
      fail(`NEXT.md does not mention queue head ${nextId}`);
    }
  } else if (list.queue.some((q) => q.status === "queued")) {
    fail("queued items exist but no runnable queue head (dependsOn blocked?)");
  }

  const lastInState = parseLastShippedFromCurrentState(currentState);
  const lastInStatus = deriveLastShippedFromStatus(statusDoc);
  if (!lastInState) {
    fail("CURRENT_STATE.md: missing Last shipped: **away-NNN**");
  } else if (lastInStatus && lastInState !== lastInStatus) {
    fail(`CURRENT_STATE last shipped (${lastInState}) !== away-status last built (${lastInStatus})`);
  }
}

function validateRoadmap() {
  const roadmap = readText(PATHS.roadmap);
  for (const rule of ROADMAP_FORBIDDEN) {
    if (rule.pattern.test(roadmap)) {
      fail(`docs/roadmap.md: stale/forbidden (${rule.label})`);
    }
  }
}

function validateMemoryMd() {
  const md = readText(PATHS.memoryMd);
  if (md.split("\n").length > 70) {
    warn(`MEMORY.md: ${md.split("\n").length} lines (target ≤70)`);
  }
  for (const pointer of [
    "CURRENT_STATE.md",
    "svscope_simple.md",
    "away-list.json",
    "AWAY_BUILD_PROTOCOL.md",
    "away:next",
    "away:batch",
    "away:plan",
  ]) {
    if (!md.includes(pointer)) {
      fail(`MEMORY.md: missing pointer or rule: ${pointer}`);
    }
  }
  if (!/Plan.*Approve.*Queue.*Execute/i.test(md)) {
    fail("MEMORY.md: missing away/sleep 4-phase workflow (Plan → Approve → Queue → Execute)");
  }
  if (!/next to build/i.test(md)) {
    fail("MEMORY.md: missing narrow 'what's next to build' answer rules");
  }
  if (!/away.*sleep|sleep.*away|overnight batch/i.test(md)) {
    fail("MEMORY.md: missing away/sleep batch phrase mapping (away = sleep = overnight)");
  }
}

function syncNextIfNeeded(list, archive) {
  const next = firstRunnableItem(list.queue, archive);
  const expected = renderNextMd(next);
  const current = readText(PATHS.nextMd);
  if (next && !current.includes(next.id)) {
    writeText(PATHS.nextMd, expected);
    warn("NEXT.md auto-synced to queue head (was stale)");
  }
}

function validatePackageScripts() {
  const pkg = readJson(path.join(REPO_ROOT, "package.json"));
  const scripts = pkg.scripts ?? {};
  if (!scripts["away:plan"]) {
    fail("package.json: missing away:plan script");
  }
}

function main() {
  const list = validateAwayList();
  const archive = readJson(PATHS.awayArchive);
  let statusDoc = { results: [] };
  if (list) {
    statusDoc = validateAwayStatus(list);
    syncNextIfNeeded(list, archive);
    validateNextIdSync(list, archive, statusDoc);
  }
  validateArchive();
  validateRoadmap();
  validateMemoryMd();
  validatePackageScripts();

  for (const w of warnings) console.warn(`WARN: ${w}`);
  if (errors.length) {
    console.error("away:validate FAILED\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("away:validate OK");
}

main();
