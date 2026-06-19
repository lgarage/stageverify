#!/usr/bin/env node
/**
 * Run verifyBeforeNext for the first runnable queued item (opt-in before coding).
 * Run: npm run away:preflight
 */
import { execSync } from "node:child_process";
import { PATHS, REPO_ROOT, firstRunnableItem, readJson } from "./lib/away-memory-lib.mjs";

const list = readJson(PATHS.awayList);
const archive = readJson(PATHS.awayArchive);
const next = firstRunnableItem(list.queue, archive);

if (!next) {
  console.error("away:preflight: no runnable queued item");
  process.exit(1);
}

const cmds = next.verifyBeforeNext ?? [];
if (cmds.length === 0) {
  console.log(JSON.stringify({ id: next.id, preflight: {}, message: "No verifyBeforeNext commands." }, null, 2));
  process.exit(0);
}

/** @type {Record<string, string>} */
const results = {};
let failed = false;

for (const cmd of cmds) {
  try {
    execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit" });
    results[cmd] = "PASS";
  } catch {
    results[cmd] = "FAIL";
    failed = true;
  }
}

console.log(JSON.stringify({ id: next.id, title: next.title, preflight: results }, null, 2));
process.exit(failed ? 1 : 0);
