#!/usr/bin/env node
/**
 * Normalize away-list executionProtocol (clear stale instructions on empty sequence).
 * Dry-run by default; pass --write to persist.
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
  readJson,
  writeJson,
} from "./lib/away-memory-lib.mjs";

const write = process.argv.includes("--write");
const list = readJson(PATHS.awayList);
const before = describeExecutionProtocolFreshness(list);
const { changed, changes } = normalizeExecutionProtocol(list);
const after = describeExecutionProtocolFreshness(list);

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
process.exit(changed && !write ? 1 : 0);
