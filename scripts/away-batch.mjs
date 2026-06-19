#!/usr/bin/env node
/**
 * Print full queued away batch in executionProtocol.sequence order.
 * Run: npm run away:batch
 */
import {
  PATHS,
  buildBatchBrief,
  readJson,
} from "./lib/away-memory-lib.mjs";

const list = readJson(PATHS.awayList);
const archive = readJson(PATHS.awayArchive);
const brief = buildBatchBrief(list, archive);

if (brief.items.length === 0) {
  console.log(
    JSON.stringify(
      {
        mode: "batch",
        items: [],
        queued: false,
        message: "No queued items in away-list.json.",
        note: brief.note,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log(JSON.stringify(brief, null, 2));
