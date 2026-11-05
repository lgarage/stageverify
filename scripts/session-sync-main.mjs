#!/usr/bin/env node
/**
 * Sync local repo with origin/main before parallel client work.
 *
 * Usage: npm run session:sync-main
 *
 * - On main: git fetch + pull --ff-only origin main
 * - On feature branch: git fetch origin main (no merge)
 * - Exit 1 if working tree is dirty or git command fails
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(process.cwd());

/** @param {string[]} args */
function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code = result.status ?? 1;
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return { code, stdout, stderr };
}

function fail(message, detail = "") {
  console.error(`session:sync-main FAIL: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

const status = git(["status", "--porcelain"]);
if (status.code !== 0) fail("git status failed", status.stderr);
if (status.stdout) {
  fail("working tree dirty — commit or stash before sync", status.stdout);
}

const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (branchResult.code !== 0) fail("could not read current branch", branchResult.stderr);
const branch = branchResult.stdout;

const fetch = git(["fetch", "origin", "main"]);
if (fetch.code !== 0) fail("git fetch origin main failed", fetch.stderr);

if (branch === "main") {
  const pull = git(["pull", "--ff-only", "origin", "main"]);
  if (pull.code !== 0) fail("git pull --ff-only origin main failed", pull.stderr || pull.stdout);
  console.log("session:sync-main PASS — on main, fast-forwarded to origin/main");
  process.exit(0);
}

const behind = git(["rev-list", "--count", `HEAD..origin/main`]);
const behindCount = behind.code === 0 ? behind.stdout : "unknown";
console.log(
  `session:sync-main PASS — on ${branch}; origin/main fetched (behind main by ${behindCount} commit(s))`,
);
process.exit(0);
