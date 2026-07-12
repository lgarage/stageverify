#!/usr/bin/env node
/**
 * Unit tests for scripts/install-git-hooks.mjs pure hook generation.
 * Run: npm run gate:check:test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOOK_MARKER, generatePrePushHook } from "./install-git-hooks.mjs";

describe("generatePrePushHook", () => {
  const hook = generatePrePushHook();

  it("starts with sh shebang", () => {
    assert.ok(hook.startsWith("#!/bin/sh\n"));
  });

  it("contains the auto-install marker comment", () => {
    assert.ok(hook.includes(HOOK_MARKER));
    assert.equal(HOOK_MARKER, "# stageverify gate-check pre-push (auto-installed)");
  });

  it("supports GATE_SKIP=1 bypass", () => {
    assert.ok(hook.includes('"$GATE_SKIP" = "1"'));
  });

  it("only gates refs/heads/main remote ref", () => {
    assert.ok(hook.includes('[ "$remote_ref" = "refs/heads/main" ] || continue'));
  });

  it("skips deletes and unifies zeros remote-sha on origin/main", () => {
    assert.ok(hook.includes('zeros="0000000000000000000000000000000000000000"'));
    assert.ok(hook.includes('[ "$local_sha" = "$zeros" ] && continue'));
    assert.ok(hook.includes('[ "$remote_sha" = "$zeros" ] && base="origin/main"'));
  });

  it("guards on node availability", () => {
    assert.ok(hook.includes("command -v node >/dev/null 2>&1"));
  });

  it("runs gate-check with commit-message evidence from repo root", () => {
    assert.ok(hook.includes('cd "$(git rev-parse --show-toplevel)"'));
    assert.ok(
      hook.includes('node scripts/gate-check.mjs --base "$base" --head "$local_sha" --evidence-from-commits'),
    );
  });

  it("blocks with exit 1, uses read -r, and shields node from the ref stdin", () => {
    assert.ok(hook.includes("exit 1"));
    assert.ok(hook.includes("while read -r local_ref local_sha remote_ref remote_sha; do"));
    assert.ok(hook.includes("--evidence-from-commits </dev/null"));
  });

  it("is LF-only (no carriage returns)", () => {
    assert.ok(!hook.includes("\r"));
  });
});
