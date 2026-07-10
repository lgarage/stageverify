#!/usr/bin/env node
/**
 * Print first runnable queued away item (dependsOn satisfied).
 * Run: npm run away:next
 * Preflight: npm run away:next -- --preflight
 * Minimal id/title: npm run away:next -- --minimal
 * Merged context packet: npm run away:next -- --packet [--tags tag1,tag2]
 */
import { execSync } from "node:child_process";
import {
  PATHS,
  REPO_ROOT,
  buildNextBrief,
  firstRunnableItem,
  readJson,
} from "./lib/away-memory-lib.mjs";
import {
  buildAwayNextPacket,
  renderAwayNextPacketMarkdown,
} from "./lib/context-packet-lib.mjs";

const args = process.argv.slice(2);
const preflight = args.includes("--preflight");
const minimal = args.includes("--minimal");
const packet = args.includes("--packet");

function parseTags(argv) {
  const idx = argv.indexOf("--tags");
  if (idx < 0 || !argv[idx + 1]) return [];
  return argv[idx + 1]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const list = readJson(PATHS.awayList);
const ci = list.executionProtocol?.commandInterface;
if (ci?.paused && !minimal) {
  console.error(
    JSON.stringify({
      paused: true,
      message:
        "Command interface pause flag set (away-list executionProtocol.commandInterface). Say Continue in Slack or clear the flag.",
    }),
  );
  process.exit(2);
}
const archive = readJson(PATHS.awayArchive);
const next = firstRunnableItem(list.queue, archive);

if (!next) {
  const queued = list.queue.filter((q) => q.status === "queued");
  if (queued.length === 0) {
    console.log(JSON.stringify({ queued: false, message: "No queued items in away-list.json." }, null, 2));
    process.exit(0);
  }
  console.error("No runnable item: dependsOn chain blocked.");
  for (const q of queued) {
    console.error(`  ${q.id} (${q.status}) dependsOn=${q.dependsOn ?? "none"}`);
  }
  process.exit(1);
}

if (minimal) {
  console.log(JSON.stringify({ id: next.id, title: next.title, dependsOn: next.dependsOn ?? null }, null, 2));
  process.exit(0);
}

if (packet) {
  const tags = parseTags(args);
  const merged = buildAwayNextPacket({ tags, list, archive });
  const formatIdx = args.indexOf("--format");
  const format = formatIdx >= 0 ? args[formatIdx + 1] : "json";
  if (format === "markdown") {
    process.stdout.write(renderAwayNextPacketMarkdown(merged));
    process.exit(0);
  }
  console.log(JSON.stringify(merged, null, 2));
  process.exit(0);
}

/** @type {Record<string, string>} */
const preflightResults = {};
if (preflight && Array.isArray(next.verifyBeforeNext)) {
  for (const cmd of next.verifyBeforeNext) {
    try {
      execSync(cmd, { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8" });
      preflightResults[cmd] = "PASS";
    } catch {
      preflightResults[cmd] = "FAIL";
    }
  }
}

const brief = buildNextBrief(next);
if (preflight) brief.preflight = preflightResults;

console.log(JSON.stringify(brief, null, 2));
