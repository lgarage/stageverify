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
  parseLastShippedFromCurrentState,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/away-memory-lib.mjs";

function usage() {
  console.error(`Usage: node scripts/away-ship.mjs --id away-NNN --commit HASH --note "text" [--status built|blocked|deferred] [--dry-run]`);
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

/** @param {string} md @param {string} id @param {string} title */
function updateCurrentState(md, id, title) {
  const shippedLine = `- Last shipped: **${id}** — ${title}`;
  if (/Last shipped:/.test(md)) {
    return md.replace(/^- Last shipped:.*$/m, shippedLine);
  }
  return md.replace(/(## Snapshot\n)/, `$1${shippedLine}\n`);
}

/** @param {{ id: string, title: string } | null} next */
function renderNextMd(next) {
  if (!next) {
    return `# Next

No queued away items. Add work to \`PROJECT_STATUS/away-list.json\` or read \`PROJECT_STATUS/CURRENT_STATE.md\` for product next steps.

Run: \`npm run away:next\`
`;
  }
  return `# Next

**ID:** \`${next.id}\`  
**Title:** ${next.title}

1. Read \`PROJECT_STATUS/MEMORY.md\` → session start pointers  
2. Read \`PROJECT_STATUS/svscope_simple.md\` — align to scope §  
3. \`npm run away:next\` — confirm dependsOn satisfied  
4. Implement → verify → \`npm run away:ship -- --id ${next.id} --note "..."\`

Run: \`npm run away:next\`
`;
}

function main() {
  const args = parseArgs(process.argv);
  const list = readJson(PATHS.awayList);
  const archive = readJson(PATHS.awayArchive);
  const item = list.queue.find((q) => q.id === args.id);
  if (!item) {
    console.error(`Item ${args.id} not in active away-list.json`);
    process.exit(1);
  }

  item.status = "done";
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

  const currentState = updateCurrentState(readText(PATHS.currentState), args.id, item.title);
  const nextItem = firstRunnableItem(list.queue, archive);
  const nextMd = renderNextMd(nextItem);

  if (args.dryRun) {
    console.log(JSON.stringify({ list, statusDoc, currentStatePreview: currentState.split("\n").slice(7, 12), nextMd }, null, 2));
    return;
  }

  writeJson(PATHS.awayList, list);
  writeJson(PATHS.awayStatus, statusDoc);
  writeText(PATHS.currentState, currentState);
  writeText(PATHS.nextMd, nextMd);

  console.log(`away-ship: ${args.id} → done (${args.status}, ${args.commit})`);
  if (nextItem) console.log(`Next queued: ${nextItem.id}`);
  else console.log("No further queued items.");
  console.log("Run: npm run away:validate");
}

main();
