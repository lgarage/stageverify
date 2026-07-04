#!/usr/bin/env node
/**
 * Cross-file memory consistency checks (Verifier).
 * Run: npm run away:validate
 */
import { execSync } from "node:child_process";
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
  updateImmediateNextInProjectState,
  writeText,
} from "./lib/away-memory-lib.mjs";
import { loadDossierIndex, loadContextIndex, validateContextIndex, validateDossierIndex } from "./lib/dossier-index-lib.mjs";
import { loadGotchaMap, validateGotchaMap } from "./lib/gotcha-map-lib.mjs";
import { loadLessonsIndex, validateLessonsIndex } from "./lib/librarian-lessons-lib.mjs";
import {
  loadIndexerMemory,
  validateIndexerMemory,
  validateIndexerMemorySlices,
} from "./lib/indexer-ingest-lib.mjs";
import { validatePendingLearnings } from "./lib/verify-learning-hook.mjs";
import {
  auditDueWarning,
  loadAuditSnapshot,
  parseEstimateLogRows,
  validateEstimateLogTiming,
} from "./lib/estimate-audit-lib.mjs";

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

    if (!["queued", "done", "blocked", "built"].includes(item.status)) {
      fail(`away-list.json: ${item.id} invalid status ${item.status}`);
    }

    if (item.status === "done") {
      fail(`away-list.json: ${item.id} is done in active queue — remove or archive (active queue: queued/blocked/built only)`);
    }

    if (item.status === "built") {
      warn(`away-list.json: ${item.id} is built in active queue — archive to PROJECT_STATUS/archives/away-batch-3.json`);
    }

    if (item.dependsOn && (item.status === "queued" || item.status === "built")) {
      const sequence = list.executionProtocol?.sequence ?? [];
      const pred = list.queue.find((q) => q.id === item.dependsOn);
      if (pred) {
        if (pred.status === "done" || pred.status === "built") {
          // ok — predecessor shipped in this batch listing
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

  const seenIds = new Set();
  for (const row of status.results) {
    if (!row?.id) continue;
    if (seenIds.has(row.id)) {
      fail(`away-status.json: duplicate id ${row.id}`);
    }
    seenIds.add(row.id);
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
    fail("CURRENT_STATE.md: missing Last shipped (**away-NNN** or standalone **title** (standalone <hash>|chore))");
  } else if (lastInState.kind === "away" && lastInStatus && lastInState.id !== lastInStatus) {
    fail(
      `CURRENT_STATE last shipped (${lastInState.id}) !== away-status last built (${lastInStatus})`,
    );
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
  const lineCount = md.split("\n").length;
  if (lineCount > 70) {
    warn(`MEMORY.md: ${lineCount} lines (target ≤70)`);
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

function syncProjectStateIfNeeded(list, archive) {
  const next = firstRunnableItem(list.queue, archive);
  const nextId = next?.id ?? null;
  const projectState = readText(PATHS.projectState);
  const projectFirst = parseFirstQueuedFromProjectState(projectState);

  if (nextId && projectFirst !== nextId) {
    writeText(PATHS.projectState, updateImmediateNextInProjectState(projectState, next));
    warn(`project_state.md auto-synced item #1 to queue head ${nextId} (was ${projectFirst ?? "missing"})`);
  } else if (!nextId && projectFirst && /^away-\d+$/.test(projectFirst)) {
    writeText(PATHS.projectState, updateImmediateNextInProjectState(projectState, null));
    warn(`project_state.md auto-synced item #1 to post-queue fallback (was ${projectFirst})`);
  }
}

function validatePackageScripts() {
  const pkg = readJson(path.join(REPO_ROOT, "package.json"));
  const scripts = pkg.scripts ?? {};
  if (!scripts["away:plan"]) {
    fail("package.json: missing away:plan script");
  }
  if (!scripts["dossier:slice"]) {
    fail("package.json: missing dossier:slice script");
  }
  if (!scripts["context:gotcha"]) {
    fail("package.json: missing context:gotcha script");
  }
  if (!scripts["context:lessons"]) {
    fail("package.json: missing context:lessons script");
  }
  if (!scripts["lessons:append"]) {
    fail("package.json: missing lessons:append script");
  }
  if (!scripts["indexer:ingest"]) {
    fail("package.json: missing indexer:ingest script");
  }
  if (!scripts["indexer:demo-packet"]) {
    fail("package.json: missing indexer:demo-packet script");
  }
  if (!scripts["indexer:demo-verify-failure"]) {
    fail("package.json: missing indexer:demo-verify-failure script");
  }
  if (!scripts["run-verify-with-learning"]) {
    fail("package.json: missing run-verify-with-learning script (verify learning wrapper)");
  }
  if (!scripts["estimate:audit"]) {
    fail("package.json: missing estimate:audit script");
  }
}

function validateCurrentStateHotTier() {
  const md = readText(PATHS.currentState);
  const lineCount = md.split("\n").length;
  if (lineCount > 35) {
    warn(`CURRENT_STATE.md: ${lineCount} lines (hot-tier target ~30)`);
  }
}

function validateDossierIndexRanges() {
  try {
    const index = loadDossierIndex();
    const drift = validateDossierIndex(index);
    if (drift.length > 0) {
      for (const msg of drift) fail(`dossier-index: ${msg}`);
      fail(
        "dossier-index.json line ranges drift from MODEL_DOSSIER.md — update startLine/endLine in dossier-index.json",
      );
    }
  } catch (err) {
    fail(`dossier-index.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateContextIndexRanges() {
  try {
    const index = loadContextIndex();
    const drift = validateContextIndex(index);
    for (const msg of drift) warn(`context-index: ${msg}`);
  } catch (err) {
    fail(`context-index.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateGotchaMapRanges() {
  try {
    const map = loadGotchaMap();
    const drift = validateGotchaMap(map);
    for (const msg of drift) warn(`gotcha-map: ${msg}`);
  } catch (err) {
    fail(`gotcha-map.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateEstimateLogRows() {
  try {
    const md = readText(path.join(REPO_ROOT, "PROJECT_STATUS/estimate-log.md"));
    const rows = parseEstimateLogRows(md);
    const { errors: timingErrors, warnings: timingWarnings } = validateEstimateLogTiming(rows);
    for (const msg of timingWarnings) warn(`estimate-log timing: ${msg}`);
    for (const msg of timingErrors) fail(`estimate-log timing: ${msg}`);
  } catch (err) {
    fail(`estimate-log timing: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateEstimateAuditDue() {
  try {
    const md = readText(path.join(REPO_ROOT, "PROJECT_STATUS/estimate-log.md"));
    const rows = parseEstimateLogRows(md);
    const snapshot = loadAuditSnapshot();
    const msg = auditDueWarning(rows.length, snapshot.lastAuditedRowCount ?? 0);
    if (msg) warn(msg);
  } catch (err) {
    warn(`estimate-audit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateIndexerMemorySliceRanges() {
  try {
    const store = loadIndexerMemory();
    const drift = validateIndexerMemorySlices(store);
    if (drift.length > 0) {
      for (const msg of drift) fail(msg);
      fail(
        "indexer-memory.json packet-injection slices drift from SSOT files — update startLine/endLine/anchor in indexer-memory.json",
      );
    }
  } catch (err) {
    fail(`indexer-memory.json slices: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateIndexerMemoryStore() {
  try {
    const store = loadIndexerMemory();
    const { errors, warnings } = validateIndexerMemory(store);
    for (const msg of warnings) warn(msg);
    for (const msg of errors) fail(msg);
  } catch (err) {
    fail(`indexer-memory.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateLessonsIndexRanges() {
  try {
    const index = loadLessonsIndex();
    const drift = validateLessonsIndex(index);
    if (drift.length > 0) {
      for (const msg of drift) fail(msg);
      fail(
        "librarian-lessons-index.json line ranges drift from LIBRARIAN_LESSONS.md — update startLine/endLine in the index (or run lessons:append which recomputes ranges)",
      );
    }
  } catch (err) {
    fail(`librarian-lessons-index.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateIndexerDemoVerifyFailure() {
  try {
    execSync("node scripts/indexer-demo-verify-failure.mjs --assert", {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    const detail =
      err instanceof Error && "stderr" in err
        ? String(/** @type {{ stdout?: string, stderr?: string }} */ (err).stderr ?? "")
        : "";
    fail(
      `indexer:demo-verify-failure regression failed${detail ? `: ${detail.trim().slice(0, 200)}` : ""}`,
    );
  }
}

function validatePendingLearningsStore() {
  try {
    const { errors, warnings } = validatePendingLearnings();
    for (const msg of warnings) warn(msg);
    for (const msg of errors) fail(msg);
  } catch (err) {
    fail(`learning-pending.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateIndexerDemoPacket() {
  try {
    execSync("node scripts/indexer-demo-packet.mjs --assert", {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (err) {
    const detail =
      err instanceof Error && "stdout" in err
        ? String(/** @type {{ stdout?: string, stderr?: string }} */ (err).stderr ?? "")
        : "";
    fail(`indexer:demo-packet regression failed${detail ? `: ${detail.trim().slice(0, 200)}` : ""}`);
  }
}

function validateRecentShipLearnings() {
  try {
    const status = readJson(PATHS.awayStatus);
    const store = loadIndexerMemory();
    const knownIds = new Set((store.entries ?? []).map((entry) => entry.id));
    for (const row of status.results ?? []) {
      const learning = /** @type {{ id?: string, action?: string } | undefined} */ (row.learning);
      if (!learning?.id) continue;
      if (learning.action === "indexer-memory" && !knownIds.has(learning.id)) {
        fail(
          `away-status ${row.id} learning ref ${learning.id} missing from indexer-memory.json — re-run away:ship --learned or fix drift`,
        );
      }
    }
  } catch (err) {
    fail(`recent ship learnings: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function main() {
  const list = validateAwayList();
  const archive = readJson(PATHS.awayArchive);
  let statusDoc = { results: [] };
  if (list) {
    statusDoc = validateAwayStatus(list);
    syncNextIfNeeded(list, archive);
    syncProjectStateIfNeeded(list, archive);
    validateNextIdSync(list, archive, statusDoc);
  }
  validateArchive();
  validateRoadmap();
  validateMemoryMd();
  validateCurrentStateHotTier();
  validatePackageScripts();
  validateDossierIndexRanges();
  validateContextIndexRanges();
  validateGotchaMapRanges();
  validateIndexerMemorySliceRanges();
  validateIndexerMemoryStore();
  validateLessonsIndexRanges();
  validateIndexerDemoPacket();
  validateIndexerDemoVerifyFailure();
  validatePendingLearningsStore();
  validateRecentShipLearnings();
  validateEstimateLogRows();
  validateEstimateAuditDue();

  for (const w of warnings) console.warn(`WARN: ${w}`);
  if (errors.length) {
    console.error("away:validate FAILED\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("away:validate OK");
}

main();
