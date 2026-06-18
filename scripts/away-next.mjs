#!/usr/bin/env node
/**
 * Print first runnable queued away item (dependsOn satisfied).
 * Run: npm run away:next
 */
import { PATHS, firstRunnableItem, readJson } from "./lib/away-memory-lib.mjs";

const list = readJson(PATHS.awayList);
const archive = readJson(PATHS.awayArchive);
const next = firstRunnableItem(list.queue, archive);

if (!next) {
  const queued = list.queue.filter((q) => q.status === "queued");
  if (queued.length === 0) {
    console.log("No queued items in away-list.json.");
    process.exit(0);
  }
  console.error("No runnable item: dependsOn chain blocked.");
  for (const q of queued) {
    console.error(`  ${q.id} (${q.status}) dependsOn=${q.dependsOn ?? "none"}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({ id: next.id, title: next.title, dependsOn: next.dependsOn ?? null }, null, 2));
