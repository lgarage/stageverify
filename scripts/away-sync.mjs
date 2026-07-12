#!/usr/bin/env node
/**
 * Normalize away-list executionProtocol + report doc drift vs CURRENT_STATE.
 * Dry-run by default; pass --write to persist queue protocol fixes.
 *
 * Exit 1 when protocol needs --write OR location-first/roadmap doc drift detected.
 * Full gate: npm run away:validate
 *
 * Run:
 *   npm run away:sync
 *   npm run away:sync -- --write
 *
 * See also: npm run away:sync-next (regenerates NEXT.md only).
 */
import path from "node:path";
import {
  PATHS,
  REPO_ROOT,
  describeExecutionProtocolFreshness,
  normalizeExecutionProtocol,
  validateLocationFirstDocConsistency,
  syncLocationFirstHotTier,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/away-memory-lib.mjs";

const write = process.argv.includes("--write");
const list = readJson(PATHS.awayList);
const before = describeExecutionProtocolFreshness(list);
const { changed, changes } = normalizeExecutionProtocol(list);
const after = describeExecutionProtocolFreshness(list);
const pkg = readJson(path.join(REPO_ROOT, "package.json"));
const docConsistency = validateLocationFirstDocConsistency({
  currentStateMd: readText(PATHS.currentState),
  specMd: readText(PATHS.locationFirstSpec),
  roadmapMd: readText(PATHS.roadmap),
});
const hotSync = syncLocationFirstHotTier({
  currentStateMd: readText(PATHS.currentState),
  specMd: readText(PATHS.locationFirstSpec),
  roadmapMd: readText(PATHS.roadmap),
  packageVersion: pkg.version ?? null,
});

/** @type {Record<string, unknown>} */
const report = {
  dryRun: !write,
  changed,
  changes,
  before,
  after: {
    ok: after.ok,
    sequenceLength: after.sequenceLength,
    instructions: list.executionProtocol?.instructions ?? null,
  },
  docConsistency: {
    ok: docConsistency.ok,
    errors: docConsistency.errors,
  },
  docSyncWouldChange: hotSync.changed,
  docSyncChanges: hotSync.changes,
};

if (write) {
  if (changed) {
    writeJson(PATHS.awayList, list);
    report.wrote = PATHS.awayList;
    console.log("away:sync: wrote PROJECT_STATUS/away-list.json");
  } else {
    report.wrote = false;
    console.log("away:sync: already fresh — no write");
  }
  if (hotSync.changed) {
    writeText(PATHS.currentState, hotSync.currentStateMd);
    writeText(PATHS.locationFirstSpec, hotSync.specMd);
    writeText(PATHS.roadmap, hotSync.roadmapMd);
    report.hotSyncWrote = [PATHS.currentState, PATHS.locationFirstSpec, PATHS.roadmap];
    console.log(`away:sync: wrote hot tier — ${hotSync.changes.join("; ")}`);
  }
} else if (changed) {
  report.hint = "Re-run with --write to apply normalization";
}

console.log(JSON.stringify(report, null, 2));
const docDrift = !docConsistency.ok;
process.exit((changed && !write) || docDrift ? 1 : 0);
