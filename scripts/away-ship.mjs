#!/usr/bin/env node
/**
 * Atomic away completion: away-list + away-status + CURRENT_STATE + NEXT.md
 * Usage:
 *   node scripts/away-ship.mjs --id away-042 --commit abc1234 --note "summary" [--status built|blocked|deferred]
 */
import { execSync } from "node:child_process";
import {
  PATHS,
  firstRunnableItem,
  readJson,
  readText,
  renderNextMd,
  updateImmediateNextInCurrentState,
  updateLastShippedInCurrentState,
  writeJson,
  writeText,
} from "./lib/away-memory-lib.mjs";

function usage() {
  console.error(
    `Usage: node scripts/away-ship.mjs --id away-NNN --commit HASH --note "text" [--status built|blocked|deferred] [--dry-run]`,
  );
  process.exit(1);
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      out.dryRun = "true";
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = argv[++i];
      if (!val) usage();
      out[key] = val;
    }
  }
  if (!out.id || !out.note) usage();
  if (!out.commit) out.commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  if (!out.status) out.status = "built";
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const list = readJson(PATHS.awayList);
  const archive = readJson(PATHS.awayArchive);
  const idx = list.queue.findIndex((q) => q.id === args.id);
  if (idx === -1) {
    console.error(`Item ${args.id} not in active away-list.json`);
    process.exit(1);
  }

  const item = list.queue[idx];
  list.queue.splice(idx, 1);
  list.executionProtocol.sequence = list.executionProtocol.sequence.filter((id) => id !== args.id);

  const statusDoc = readJson(PATHS.awayStatus);
  statusDoc.lastRun = new Date().toISOString().slice(0, 10);
  statusDoc.results = statusDoc.results.filter((r) => r.id !== args.id);
  statusDoc.results.push({
    id: args.id,
    title: item.title,
    status: args.status,
    commit: args.commit,
    note: args.note,
  });

  let currentState = readText(PATHS.currentState);
  currentState = updateLastShippedInCurrentState(currentState, args.id, item.title);
  const nextItem = firstRunnableItem(list.queue, archive);
  currentState = updateImmediateNextInCurrentState(currentState, nextItem);
  const nextMd = renderNextMd(nextItem);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        { list, statusDoc, currentStatePreview: currentState.split("\n").slice(7, 20), nextMd },
        null,
        2,
      ),
    );
    return;
  }

  writeJson(PATHS.awayList, list);
  writeJson(PATHS.awayStatus, statusDoc);
  writeText(PATHS.currentState, currentState);
  writeText(PATHS.nextMd, nextMd);

  console.log(`away-ship: ${args.id} → shipped (${args.status}, ${args.commit})`);
  if (nextItem) console.log(`Next queued: ${nextItem.id}`);
  else console.log("No further queued items.");
  console.log("Run: npm run away:validate");
}

main();
