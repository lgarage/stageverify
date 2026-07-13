#!/usr/bin/env node
/**
 * Pre-push gate hook installer (D-29 — ecosystem-wide D-28 evidence gate).
 *
 * Purpose: block direct high-risk pushes to `main` without the security-gate evidence
 * block in commit messages, on every machine (desktop PC, cloud VM) — not just cloud PRs.
 * The hook runs `gate-check.mjs --evidence-from-commits` per pushed main ref.
 *
 * Bypass: `GATE_SKIP=1 git push` or `git push --no-verify` — documented, advisory-vs-malice
 * (same D-28 contract): the gate protects against honest mistakes, not hostile actors;
 * branch protection + human review remain the backstop.
 *
 * Always exits 0 — runs from npm `prepare` on every `npm ci`/`npm install` (PC, cloud VM
 * startup, CI) and must NEVER break an install: no .git, missing/unwritable hooks dir, or
 * any other error → short note (or nothing) and exit 0.
 *
 * Install: npm run hooks:install (also auto via npm prepare)
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK_MARKER = "# stageverify gate-check pre-push (auto-installed)";

/**
 * Pure generator for the pre-push hook script text (POSIX sh, LF only).
 * @returns {string}
 */
export function generatePrePushHook() {
  return [
    "#!/bin/sh",
    HOOK_MARKER,
    "# Blocks high-risk pushes to main without security-gate evidence in commit messages (D-28/D-29).",
    "# Bypass (advisory-vs-malice): GATE_SKIP=1 git push  OR  git push --no-verify",
    'if [ "$GATE_SKIP" = "1" ]; then',
    '  echo "gate-check: skipped (GATE_SKIP=1)"',
    "  exit 0",
    "fi",
    'command -v node >/dev/null 2>&1 || { echo "WARN: node not found - gate-check skipped"; exit 0; }',
    'cd "$(git rev-parse --show-toplevel)" || exit 0',
    'zeros="0000000000000000000000000000000000000000"',
    "while read -r local_ref local_sha remote_ref remote_sha; do",
    '  [ "$remote_ref" = "refs/heads/main" ] || continue',
    '  [ "$local_sha" = "$zeros" ] && continue',
    '  base="$remote_sha"',
    '  [ "$remote_sha" = "$zeros" ] && base="origin/main"',
    '  if ! node scripts/gate-check.mjs --base "$base" --head "$local_sha" --evidence-from-commits </dev/null; then',
    '    echo ""',
    '    echo "gate-check: push to main blocked - high-risk paths need the security-gate evidence block"',
    '    echo "(security-gate-id + model line) in a commit message of the pushed range."',
    '    echo "Bypass (advisory-vs-malice, D-28): GATE_SKIP=1 git push  OR  git push --no-verify"',
    "    exit 1",
    "  fi",
    "done",
    "exit 0",
    "",
  ].join("\n");
}

function main() {
  try {
    const gitDirRaw = execFileSync("git", ["rev-parse", "--git-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(process.cwd(), gitDirRaw);
    const hooksDir = join(gitDir, "hooks");
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }
    const hookPath = join(hooksDir, "pre-push");
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf8");
      if (!existing.includes(HOOK_MARKER)) {
        console.log("WARN: existing pre-push hook not installed by stageverify — leaving it untouched");
        return;
      }
    }
    writeFileSync(hookPath, generatePrePushHook(), { encoding: "utf8" });
    chmodSync(hookPath, 0o755);
    console.log(`installed pre-push gate hook: ${hookPath}`);
  } catch {
    // Never break npm install (PC, cloud VM startup npm ci, CI) — no .git, unwritable
    // hooks dir, or any other failure is fine; the CI PR gate still applies.
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main();
}
