#!/usr/bin/env node
/**
 * Cross-file memory consistency checks (Verifier seed).
 * Run: npm run away:validate
 */
import {
  PATHS,
  ROADMAP_FORBIDDEN,
  firstRunnableItem,
  parseLastShippedFromCurrentState,
  readJson,
  readText,
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
      fail(
        `away-list.json: ${item.id} is done in active queue — archive done items (active queue should be queued/blocked only)`,
      );
    }

    if (item.dependsOn && item.status === "queued") {
      const pred = list.queue.find((q) => q.id === item.dependsOn);
      if (pred) {
        if (pred.status !== "done") {
          fail(`away-list.json: ${item.id} dependsOn ${item.dependsOn} but predecessor is ${pred.status}`);
        }
      } else {
        const archive = readJson(PATHS.awayArchive);
        const archived = archive.items?.find((a) => a.id === item.dependsOn);
        if (!archived || archived.status !== "done") {
          fail(
            `away-list.json: ${item.id} dependsOn ${item.dependsOn} — not done in queue or archive (status=${archived?.status ?? "missing"})`,
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
      fail(
        `drift: ${item.id} is queued in away-list but built in away-status — run away:ship or fix manually`,
      );
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

function validateCurrentState(list) {
  const md = readText(PATHS.currentState);
  const lines = md.split("\n").length;
  if (lines > 35) {
    warn(`CURRENT_STATE.md: ${lines} lines (target ~30)`);
  }

  const lastShipped = parseLastShippedFromCurrentState(md);
  if (!lastShipped) {
    fail("CURRENT_STATE.md: missing Last shipped: **away-NNN**");
  } else if (lastShipped !== "away-041") {
    warn(`CURRENT_STATE.md: Last shipped is ${lastShipped} (expected away-041 until next ship)`);
  }

  const queued = list.queue.filter((q) => q.status === "queued");
  if (queued.length === 0 && md.includes("not in away queue yet") === false) {
    // ok either way
  }
}

function validateNextMd(list, archive) {
  if (!readText(PATHS.nextMd).includes("# Next")) {
    fail("NEXT.md: missing or invalid (expected # Next header)");
    return;
  }

  const next = firstRunnableItem(list.queue, archive);
  const nextMd = readText(PATHS.nextMd);
  if (next) {
    if (!nextMd.includes(next.id)) {
      fail(`NEXT.md: does not mention first queued item ${next.id}`);
    }
  } else if (!nextMd.toLowerCase().includes("no queued") && !nextMd.includes("away-042")) {
    warn("NEXT.md: no runnable queued item but NEXT.md may be stale");
  }
}

function validateRoadmap() {
  const roadmap = readText(PATHS.roadmap);
  for (const rule of ROADMAP_FORBIDDEN) {
    if (rule.pattern.test(roadmap)) {
      fail(`docs/roadmap.md: stale row (${rule.label}) — batch 3 shipped but traceability still ⬜`);
    }
  }

  if (/### Phase 3 Slice 4 — Vendor access hardening \(not started\)/.test(roadmap)) {
    fail("docs/roadmap.md: Slice 4 section still says (not started)");
  }
  if (/### Phase 3 Slice 5 — Pickup link security \(not started\)/.test(roadmap)) {
    fail("docs/roadmap.md: Slice 5 section still says (not started)");
  }
}

function validateMemoryMd() {
  const md = readText(PATHS.memoryMd);
  const lines = md.split("\n").length;
  if (lines > 65) {
    warn(`MEMORY.md: ${lines} lines (target ≤60)`);
  }
  for (const pointer of ["CURRENT_STATE.md", "svscope_simple.md", "away-list.json", "AWAY_BUILD_PROTOCOL.md"]) {
    if (!md.includes(pointer)) {
      fail(`MEMORY.md: missing pointer to ${pointer}`);
    }
  }
}

function main() {
  const list = validateAwayList();
  const archive = readJson(PATHS.awayArchive);
  if (list) {
    validateAwayStatus(list);
    validateCurrentState(list);
    validateNextMd(list, archive);
  }
  validateArchive();
  validateRoadmap();
  validateMemoryMd();

  for (const w of warnings) console.warn(`WARN: ${w}`);
  if (errors.length) {
    console.error("away:validate FAILED\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("away:validate OK");
}

main();
