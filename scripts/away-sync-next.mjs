#!/usr/bin/env node
/**
 * Regenerate NEXT.md from active away queue.
 * Run: npm run away:sync-next
 */
import {
  PATHS,
  firstRunnableItem,
  readJson,
  renderNextMd,
  writeText,
} from "./lib/away-memory-lib.mjs";

const list = readJson(PATHS.awayList);
const archive = readJson(PATHS.awayArchive);
const next = firstRunnableItem(list.queue, archive);
writeText(PATHS.nextMd, renderNextMd(next));
console.log(`away:sync-next: ${next ? next.id : "no queued item"}`);
