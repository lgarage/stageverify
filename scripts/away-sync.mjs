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
import {
  PATHS,
  describeExecutionProtocolFreshness,
  normalizeExecutionProtocol,
  validateLocationFirstDocConsistency,
  readJson,
  readText,
  writeJson,
} from "./lib/away-memory-lib.mjs";

const write = process.argv.includes("--write");
const list = readJson(PATHS.awayList);
const before = describeExecutionProtocolFreshness(list);
const { changed, changes } = normalizeExecutionProtocol(list);
const after = describeExecutionProtocolFreshness(list);
const docConsistency = validateLocationFirstDocConsistency({
  currentStateMd: readText(PATHS.currentState),
  specMd: readText(PATHS.locationFirstSpec),
  roadmapMd: readText(PATHS.roadmap),
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
} else if (changed) {
  report.hint = "Re-run with --write to apply normalization";
}

console.log(JSON.stringify(report, null, 2));
const docDrift = !docConsistency.ok;
process.exit((changed && !write) || docDrift ? 1 : 0);
