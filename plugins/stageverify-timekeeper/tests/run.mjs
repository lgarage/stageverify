#!/usr/bin/env node
/**
 * StageVerify Timekeeper — scenario tests (no Cursor runtime required).
 * Run: node plugins/stageverify-timekeeper/tests/run.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, THRESHOLDS_MS, saveState, loadState } from "../scripts/lib/state.mjs";
import { evaluate, buildHookResponse, formatTimekeeperBlock } from "../scripts/lib/decisions.mjs";
import { normalizeCommandSignature, classifyOutputOutcome } from "../scripts/lib/signatures.mjs";
import { classifyFailure } from "../scripts/lib/classify.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`  ${err.message}`);
  }
}

function fresh(now = 1_000_000) {
  return emptyState("test-conv", now);
}

function hasKind(interventions, kind) {
  return interventions.some((i) => i.kind === kind);
}

function decisionText(interventions) {
  return interventions.map((i) => `${i.kind}: ${i.decision}`).join(" | ");
}

// --- Unit helpers ---
test("signature normalization strips paths/timestamps", () => {
  const a = normalizeCommandSignature(
    "node /workspace/scripts/verify-x.mjs --at 2026-08-09T04:00:00Z abcdef1234567890"
  );
  const b = normalizeCommandSignature(
    "node /other/scripts/verify-x.mjs --at 2026-08-09T05:00:00Z ffeeddccbbaa99887766"
  );
  assert.equal(a, b);
});

test("output outcome heuristic without exit code", () => {
  assert.equal(classifyOutputOutcome("Error: Timeout 30000ms exceeded"), "fail");
  assert.equal(classifyOutputOutcome("verify:pickup PASS"), "pass");
  assert.equal(classifyOutputOutcome("running..."), "unknown");
});

test("protected-command response never denies", () => {
  const state = fresh();
  const resp = buildHookResponse(
    "beforeShellExecution",
    [
      {
        kind: "thrash",
        stateLabel: "stalled",
        reason: "x",
        decision: "stop",
        message: "TIMEKEEPER\ntest",
      },
    ],
    state,
    {}
  );
  assert.equal(resp.permission, "allow");
  assert.ok(resp.agent_message);
});

// --- Scenario 1: performance measurement fails twice ---
test("1. performance measurement fails twice → thrash + measurement_tool_failure", () => {
  const state = fresh();
  const cmd = "npm run verify:vendor-perf -- --samples 20";
  const failOut = "TimeoutError: benchmark timed out after 60000ms median sample";
  let r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: failOut,
      duration: 60000,
    },
    1_000_000
  );
  assert.equal(hasKind(r.interventions, "thrash"), false, "first fail should not thrash");
  r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: failOut,
      duration: 60000,
    },
    1_000_100
  );
  assert.ok(hasKind(r.interventions, "thrash"), decisionText(r.interventions));
  const thrash = r.interventions.find((i) => i.kind === "thrash");
  assert.equal(thrash.failureClass, "measurement_tool_failure");
  console.log("   decision:", thrash.decision.slice(0, 120));
});

// --- Scenario 2: 4-digit PIN mistaken for 6-digit autosubmit ---
test("2. PIN 4-digit autosubmit wait → measurement_tool_failure + change method", () => {
  const state = fresh();
  const cmd = "node scripts/verify-vendor-pin-timing.mjs";
  const out =
    "waiting for 6-digit autosubmit on PIN keypad; TimeoutError after 30000ms";
  evaluate(
    state,
    { hook_event_name: "postToolUseFailure", tool_name: "Shell", tool_input: { command: cmd }, error_message: out, failure_type: "timeout", command: cmd },
    1_000_000
  );
  const r = evaluate(
    state,
    { hook_event_name: "postToolUseFailure", tool_name: "Shell", tool_input: { command: cmd }, error_message: out, failure_type: "timeout", command: cmd },
    1_000_200
  );
  const thrash = r.interventions.find((i) => i.kind === "thrash");
  assert.ok(thrash);
  assert.equal(thrash.failureClass, "measurement_tool_failure");
  assert.match(thrash.message, /measurement-tool failure/i);
  console.log("   decision:", thrash.decision.slice(0, 120));
});

// --- Scenario 3: gh-pages propagating ---
test("3. gh-pages propagating → bounded wait, not restart deploy", () => {
  const state = fresh();
  const cmd = "curl -s https://lgarage.github.io/stageverify/";
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = evaluate(
      state,
      {
        hook_event_name: "afterShellExecution",
        command: cmd,
        output: "old bundle — gh-pages propagation pending",
        duration: 500,
      },
      1_000_000 + i * 1000
    );
  }
  assert.equal(state.waitPolls.gh_pages.count, 3);
  assert.ok(hasKind(last.interventions, "wait_poll"), decisionText(last.interventions));
  const w = last.interventions.find((i) => i.kind === "wait_poll");
  assert.match(w.decision, /bounded polling|Do not restart/i);
  assert.equal(w.failureClass, "deploy_propagation_wait");
  console.log("   decision:", w.decision);
});

// --- Scenario 4: main moves, PR clean ---
test("4. main moves but PR clean → do not redo work", () => {
  const state = fresh();
  const r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git pull origin main",
      output: "Already up to date.",
      duration: 200,
    },
    1_000_000
  );
  assert.ok(hasKind(r.interventions, "main_clean"), decisionText(r.interventions));
  const i = r.interventions.find((x) => x.kind === "main_clean");
  assert.match(i.decision, /do not automatically redo/i);
  // Second pull must not spam
  const r2 = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git pull origin main",
      output: "Already up to date.",
      duration: 200,
    },
    1_000_500
  );
  assert.equal(hasKind(r2.interventions, "main_clean"), false);
  console.log("   decision:", i.decision);
});

// --- Scenario 5: merge conflict ---
test("5. merge conflict → resolve only actual conflict", () => {
  const state = fresh();
  const r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git merge origin/main",
      output: "CONFLICT (content): Merge conflict in README.md\nAutomatic merge failed",
      duration: 300,
    },
    1_000_000
  );
  assert.ok(hasKind(r.interventions, "merge_conflict"));
  const i = r.interventions.find((x) => x.kind === "merge_conflict");
  assert.match(i.decision, /only actual conflict/i);
  console.log("   decision:", i.decision);
});

// --- Scenario 6: D-38/D-60 green, later benchmark fails ---
test("6. green D-38/D-60 preserved when later benchmark fails", () => {
  const state = fresh();
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "npm run gate:check",
      output: "security-gate-id: 12345678-1234-1234-1234-123456789abc\nsonnet-verify: PASS",
      duration: 1000,
    },
    1_000_000
  );
  assert.equal(state.greenEvidence.d38, true);
  assert.equal(state.greenEvidence.d60, true);
  const cmd = "node scripts/bench-vendor.mjs";
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: "benchmark timeout median sample",
      duration: 60000,
    },
    1_001_000
  );
  const r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: "benchmark timeout median sample",
      duration: 60000,
    },
    1_002_000
  );
  const thrash = r.interventions.find((i) => i.kind === "thrash");
  assert.ok(thrash);
  assert.equal(state.greenEvidence.d38, true);
  assert.equal(state.greenEvidence.d60, true);
  assert.match(thrash.message, /Do not invalidate already-green D-38\/D-60/i);
  console.log("   decision: keep D-38/D-60; classify measurement failure");
});

// --- Scenario 7: implementation done, measurement drags ---
test("7. implementation done quickly; measurement drags → completion_focus", () => {
  const state = fresh(1_000_000);
  markEdit(state, 1_000_000);
  // Advance wall clock to 25m with no recent progress
  state.lastProgressAt = 1_000_000;
  const r = evaluate(
    state,
    { hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command: "npm run verify:vendor-perf" } },
    1_000_000 + THRESHOLDS_MS.focus + 1000
  );
  assert.ok(hasKind(r.interventions, "focus25"), decisionText(r.interventions));
  assert.equal(state.mode, "completion_focus");
  console.log("   decision:", r.interventions.find((i) => i.kind === "focus25").decision.slice(0, 140));
});

function markEdit(state, now) {
  evaluate(
    state,
    { hook_event_name: "afterFileEdit", file_path: "/workspace/src/Foo.tsx" },
    now
  );
}

// --- Scenario 8: genuine implementation failure → two-fail escalation path ---
test("8. implementation failure twice → thrash points at D-19/D-50", () => {
  const state = fresh();
  const cmd = "npm run build";
  const out = "error TS2322: Type 'string' is not assignable at src/x.ts:42";
  evaluate(
    state,
    { hook_event_name: "afterShellExecution", command: cmd, output: out, duration: 5000 },
    1_000_000
  );
  const r = evaluate(
    state,
    { hook_event_name: "afterShellExecution", command: cmd, output: out, duration: 5000 },
    1_001_000
  );
  const thrash = r.interventions.find((i) => i.kind === "thrash");
  assert.ok(thrash);
  assert.equal(thrash.failureClass, "implementation_failure");
  assert.match(thrash.decision, /D-19\/D-50/);
  console.log("   decision:", thrash.decision.slice(0, 140));
});

// --- Scenario 9: long op still progressing ---
test("9. long operation still producing progress → no stall intervention", () => {
  const state = fresh(1_000_000);
  // Every 5 minutes a file edit (progress) across 20 minutes
  for (let i = 0; i < 4; i++) {
    const t = 1_000_000 + i * 5 * 60 * 1000;
    const r = evaluate(
      state,
      { hook_event_name: "afterFileEdit", file_path: `/workspace/src/f${i}.ts` },
      t
    );
    assert.equal(hasKind(r.interventions, "stall10"), false);
  }
  // At 20m with fresh progress, stall must not fire
  const r = evaluate(
    state,
    { hook_event_name: "preToolUse", tool_name: "Read", tool_input: {} },
    1_000_000 + 20 * 60 * 1000
  );
  assert.equal(hasKind(r.interventions, "stall10"), false);
  // status15 may fire (elapsed) — that's ok; stall must not
  console.log("   decision: continue — progress observed; no stall");
});

// --- Scenario 10: 35m with noncritical measurement unavailable ---
test("10. 35m + unavailable measurement → force_choice A/B/C/D", () => {
  const state = fresh(1_000_000);
  state.greenEvidence.build = true;
  state.lastProgressAt = 1_000_000 + 5 * 60 * 1000;
  const r = evaluate(
    state,
    {
      hook_event_name: "postToolUse",
      tool_name: "Shell",
      tool_input: { command: "echo done" },
      tool_output: "{}",
      duration: 10,
    },
    1_000_000 + THRESHOLDS_MS.force + 5000
  );
  assert.ok(hasKind(r.interventions, "force35"), decisionText(r.interventions));
  const i = r.interventions.find((x) => x.kind === "force35");
  assert.match(i.decision, /\(A\).*finish|\(C\).*PARTIAL|\(D\).*BLOCKED/i);
  assert.equal(state.mode, "force_choice");
  // Measurement unavailable advice: PARTIAL is valid
  console.log("   decision:", i.decision.slice(0, 160));
});

// --- Green-stamp must not skip required verify (contract text) ---
test("contract: timekeeper messages forbid skipping D-38/D-60/verify", () => {
  const state = fresh();
  const msg = formatTimekeeperBlock(
    state,
    1_000_000,
    {
      stateLabel: "stalled",
      reason: "x",
      decision: "y",
      failureClass: "measurement_tool_failure",
    }
  );
  assert.match(msg, /Never skip required D-38\/D-60/);
});

// --- Lazy-init clock ---
test("lazy-init: startedAt set on first load when missing sessionStart", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-"));
  try {
    const state = loadState("lazy-1", [dir], 5_000_000);
    assert.equal(state.startedAt, 5_000_000);
    saveState(state, [dir]);
    const again = loadState("lazy-1", [dir], 5_100_000);
    assert.equal(again.startedAt, 5_000_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- buildHookResponse stop followup ---
test("stop at force_choice can emit one followup_message", () => {
  const state = fresh();
  state.mode = "force_choice";
  state.firedCheckpoints.force35 = true;
  const resp = buildHookResponse("stop", [], state, { loop_count: 0 });
  assert.ok(resp.followup_message);
  assert.match(resp.followup_message, /TIMEKEEPER/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
