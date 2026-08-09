#!/usr/bin/env node
/**
 * StageVerify Timekeeper — scenario tests (no Cursor runtime required).
 * Run: node plugins/stageverify-timekeeper/tests/run.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyState,
  THRESHOLDS_MS,
  saveState,
  loadState,
  getDeliveryStatus,
  isReliableDeliveryHook,
} from "../scripts/lib/state.mjs";
import {
  evaluate,
  buildHookResponse,
  formatTimekeeperBlock,
  responseCarriesAdvice,
  queuePending,
  selectPendingForDelivery,
  ELAPSED_CHECKPOINT_COPY,
} from "../scripts/lib/decisions.mjs";
import { normalizeCommandSignature, classifyOutputOutcome } from "../scripts/lib/signatures.mjs";

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

function progressEdit(state, now, name = "Foo.tsx") {
  return evaluate(
    state,
    { hook_event_name: "afterFileEdit", file_path: `/workspace/src/${name}` },
    now
  );
}

function deliver(state, now, hook = "preToolUse") {
  return evaluate(
    state,
    { hook_event_name: hook, tool_name: "Read", tool_input: {} },
    now
  );
}

function shellFail(state, now, cmd, out) {
  return evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: out,
      duration: 1000,
    },
    now
  );
}

// --- Unit helpers ---
test("dual shell hooks for one failure do not false-thrash", () => {
  const state = fresh();
  const cmd = "npm run verify:pickup";
  const out = "Error: Timeout 30000ms exceeded";
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: cmd,
      output: out,
      duration: 30000,
    },
    1_000_000
  );
  const r = evaluate(
    state,
    {
      hook_event_name: "postToolUseFailure",
      tool_name: "Shell",
      tool_input: { command: cmd },
      command: cmd,
      error_message: out,
      failure_type: "timeout",
      duration: 30000,
    },
    1_000_050
  );
  assert.equal(Object.values(state.signatures)[0].failCount, 1);
  assert.equal(hasKind(r.interventions, `thrash:${normalizeCommandSignature(cmd)}`), false);
  shellFail(state, 1_010_000, cmd, out);
  const r2 = deliver(state, 1_010_100);
  assert.ok(
    r2.interventions.some((i) => i.kind.startsWith("thrash:")),
    decisionText(r2.interventions)
  );
});

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
  assert.ok(responseCarriesAdvice(resp));
});

test("hook channel classification: reliable vs best-effort", () => {
  assert.equal(isReliableDeliveryHook("preToolUse"), true);
  assert.equal(isReliableDeliveryHook("postToolUse"), true);
  assert.equal(isReliableDeliveryHook("beforeShellExecution"), true);
  assert.equal(isReliableDeliveryHook("stop"), true);
  assert.equal(isReliableDeliveryHook("afterShellExecution"), false);
  assert.equal(isReliableDeliveryHook("afterFileEdit"), false);
  assert.equal(isReliableDeliveryHook("postToolUseFailure"), false);
  assert.equal(isReliableDeliveryHook("subagentStop"), false);
});

// --- Legacy scenarios (updated for pending→reliable delivery) ---
test("1. performance measurement fails twice → thrash + measurement_tool_failure", () => {
  const state = fresh();
  const cmd = "npm run verify:vendor-perf -- --samples 20";
  const failOut = "TimeoutError: benchmark timed out after 60000ms median sample";
  shellFail(state, 1_000_000, cmd, failOut);
  shellFail(state, 1_000_100, cmd, failOut);
  const r = deliver(state, 1_000_200);
  const thrash = r.interventions.find((i) => i.kind.startsWith("thrash:"));
  assert.ok(thrash, decisionText(r.interventions));
  assert.equal(thrash.failureClass, "measurement_tool_failure");
  assert.match(thrash.decision, /D-19\/D-50/);
  console.log("   decision:", thrash.decision.slice(0, 120));
});

test("2. PIN 4-digit autosubmit wait → measurement_tool_failure + change method", () => {
  const state = fresh();
  const cmd = "node scripts/verify-vendor-pin-timing.mjs";
  const out =
    "waiting for 6-digit autosubmit on PIN keypad; TimeoutError after 30000ms";
  evaluate(
    state,
    {
      hook_event_name: "postToolUseFailure",
      tool_name: "Shell",
      tool_input: { command: cmd },
      error_message: out,
      failure_type: "timeout",
      command: cmd,
    },
    1_000_000
  );
  evaluate(
    state,
    {
      hook_event_name: "postToolUseFailure",
      tool_name: "Shell",
      tool_input: { command: cmd },
      error_message: out,
      failure_type: "timeout",
      command: cmd,
    },
    1_000_200
  );
  const r = deliver(state, 1_000_300);
  const thrash = r.interventions.find((i) => i.kind.startsWith("thrash:"));
  assert.ok(thrash);
  assert.equal(thrash.failureClass, "measurement_tool_failure");
  assert.match(thrash.message, /measurement-tool failure/i);
});

test("3. gh-pages propagating → bounded wait, not restart deploy", () => {
  const state = fresh();
  const cmd = "curl -s https://lgarage.github.io/stageverify/";
  for (let i = 0; i < 3; i++) {
    evaluate(
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
  const r = deliver(state, 1_003_000);
  assert.ok(
    r.interventions.some((i) => i.kind.startsWith("wait_poll:")),
    decisionText(r.interventions)
  );
});

test("4. main moves but PR clean → do not redo work", () => {
  const state = fresh();
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git pull origin main",
      output: "Already up to date.",
      duration: 200,
    },
    1_000_000
  );
  const r = deliver(state, 1_000_100);
  assert.ok(hasKind(r.interventions, "main_clean"), decisionText(r.interventions));
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git pull origin main",
      output: "Already up to date.",
      duration: 200,
    },
    1_000_500
  );
  const r2 = deliver(state, 1_000_600);
  assert.equal(hasKind(r2.interventions, "main_clean"), false);
});

test("5. merge conflict → resolve only actual conflict", () => {
  const state = fresh();
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "git merge origin/main",
      output: "CONFLICT (content): Merge conflict in README.md\nAutomatic merge failed",
      duration: 300,
    },
    1_000_000
  );
  const r = deliver(state, 1_000_100);
  assert.ok(hasKind(r.interventions, "merge_conflict"));
});

test("6. green D-38/D-60 preserved when later benchmark fails", () => {
  const state = fresh();
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "npm run gate:check",
      output:
        "security-gate-id: 12345678-1234-1234-1234-123456789abc\nsonnet-verify: PASS",
      duration: 1000,
    },
    1_000_000
  );
  assert.equal(state.greenEvidence.d38, true);
  assert.equal(state.greenEvidence.d60, true);
  const cmd = "node scripts/bench-vendor.mjs";
  shellFail(state, 1_001_000, cmd, "benchmark timeout median sample");
  shellFail(state, 1_002_000, cmd, "benchmark timeout median sample");
  const r = deliver(state, 1_002_100);
  const thrash = r.interventions.find((i) => i.kind.startsWith("thrash:"));
  assert.ok(thrash);
  assert.equal(state.greenEvidence.d38, true);
  assert.equal(state.greenEvidence.d60, true);
  assert.match(thrash.message, /Do not invalidate already-green D-38\/D-60/i);
});

test("7. implementation done quickly; measurement drags → focus25", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000);
  state.lastProgressAt = 1_000_000 + 20 * 60 * 1000;
  const r = deliver(state, 1_000_000 + THRESHOLDS_MS.focus25 + 1000);
  assert.ok(hasKind(r.interventions, "focus25"), decisionText(r.interventions));
  assert.equal(state.mode, "completion_focus");
});

test("8. implementation failure twice → thrash points at D-19/D-50", () => {
  const state = fresh();
  const cmd = "npm run build";
  const out = "error TS2322: Type 'string' is not assignable at src/x.ts:42";
  shellFail(state, 1_000_000, cmd, out);
  shellFail(state, 1_001_000, cmd, out);
  const r = deliver(state, 1_001_100);
  const thrash = r.interventions.find((i) => i.kind.startsWith("thrash:"));
  assert.ok(thrash);
  assert.equal(thrash.failureClass, "implementation_failure");
  assert.match(thrash.decision, /D-19\/D-50/);
  const resp = buildHookResponse("beforeShellExecution", r.interventions, state, {});
  assert.equal(resp.permission, "allow");
});

test("9. long operation still producing progress → no stall intervention", () => {
  const state = fresh(1_000_000);
  for (let i = 0; i < 4; i++) {
    const t = 1_000_000 + i * 5 * 60 * 1000;
    progressEdit(state, t, `f${i}.ts`);
    assert.equal(getDeliveryStatus(state, "stall10"), "not_due");
  }
  const r = deliver(state, 1_000_000 + 20 * 60 * 1000);
  assert.equal(hasKind(r.interventions, "stall10"), false);
});

test("10. 35m → force35 D-66 terminal guidance", () => {
  const state = fresh(1_000_000);
  state.greenEvidence.build = true;
  state.lastProgressAt = 1_000_000 + 5 * 60 * 1000;
  const r = deliver(state, 1_000_000 + THRESHOLDS_MS.force35 + 5000);
  assert.ok(hasKind(r.interventions, "force35"), decisionText(r.interventions));
  const i = r.interventions.find((x) => x.kind === "force35");
  assert.match(i.decision, /DONE \/ BLOCKED \/ FAILED \/ PARTIAL/);
  assert.equal(state.mode, "force_choice");
});

test("contract: timekeeper messages forbid skipping D-38/D-60/verify", () => {
  const state = fresh();
  const msg = formatTimekeeperBlock(state, 1_000_000, {
    stateLabel: "stalled",
    reason: "x",
    decision: "y",
    failureClass: "measurement_tool_failure",
  });
  assert.match(msg, /Never skip required D-38\/D-60/);
});

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

test("stop at force_choice can emit one followup_message", () => {
  const state = fresh();
  state.mode = "force_choice";
  state.delivery.force35 = { status: "delivered", queuedAt: 1, deliveredAt: 1, family: "elapsed", payload: null };
  const resp = buildHookResponse("stop", [], state, { loop_count: 0 });
  assert.ok(resp.followup_message);
  assert.match(resp.followup_message, /TIMEKEEPER/);
  assert.match(resp.followup_message, /D-66/);
});

// --- Cadence A–G ---
test("A. healthy 9m — no elapsed checkpoint, no stall", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 4 * 60 * 1000);
  const r = deliver(state, 1_000_000 + 9 * 60 * 1000);
  assert.equal(r.interventions.filter((i) => i.family === "elapsed" || ELAPSED_CHECKPOINT_COPY[i.kind]).length, 0);
  assert.equal(hasKind(r.interventions, "stall10"), false);
  assert.equal(getDeliveryStatus(state, "status10"), "not_due");
});

test("B. healthy 12m — status10 once, no stall10", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  const r = deliver(state, 1_000_000 + 12 * 60 * 1000);
  assert.ok(hasKind(r.interventions, "status10"));
  assert.equal(hasKind(r.interventions, "stall10"), false);
  const r2 = deliver(state, 1_000_000 + 12 * 60 * 1000 + 1000);
  assert.equal(hasKind(r2.interventions, "status10"), false);
  assert.equal(getDeliveryStatus(state, "status10"), "delivered");
});

test("C. healthy 17m — status10 + focus15 once each, no duplicates", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  const r1 = deliver(state, 1_000_000 + 12 * 60 * 1000);
  assert.ok(hasKind(r1.interventions, "status10"));
  progressEdit(state, 1_000_000 + 14 * 60 * 1000, "b.ts");
  const r2 = deliver(state, 1_000_000 + 17 * 60 * 1000);
  assert.ok(hasKind(r2.interventions, "focus15"));
  assert.equal(hasKind(r2.interventions, "status10"), false);
  const r3 = deliver(state, 1_000_000 + 17 * 60 * 1000 + 500);
  assert.equal(hasKind(r3.interventions, "focus15"), false);
});

test("D. healthy 23m — status10, focus15, focus20; no stall10", () => {
  const state = fresh(1_000_000);
  const marks = [5, 12, 16, 21].map((m) => 1_000_000 + m * 60 * 1000);
  const delivered = [];
  for (const t of marks) {
    progressEdit(state, t - 1000, `p${t}.ts`);
    const r = deliver(state, t);
    for (const i of r.interventions) delivered.push(i.kind);
  }
  // Final at 23m
  progressEdit(state, 1_000_000 + 22 * 60 * 1000, "late.ts");
  const r = deliver(state, 1_000_000 + 23 * 60 * 1000);
  for (const i of r.interventions) delivered.push(i.kind);
  assert.ok(delivered.includes("status10"));
  assert.ok(delivered.includes("focus15"));
  assert.ok(delivered.includes("focus20"));
  assert.equal(delivered.includes("stall10"), false);
  assert.equal(delivered.filter((k) => k === "focus20").length, 1);
});

test("E. healthy 28m — through focus25, no duplicates", () => {
  const state = fresh(1_000_000);
  const times = [11, 16, 21, 26, 28].map((m) => 1_000_000 + m * 60 * 1000);
  const got = [];
  for (const t of times) {
    progressEdit(state, t - 500, `e${t}.ts`);
    const r = deliver(state, t);
    for (const i of r.interventions) got.push(i.kind);
  }
  for (const k of ["status10", "focus15", "focus20", "focus25"]) {
    assert.equal(got.filter((x) => x === k).length, 1, `${k} count`);
  }
});

test("F. healthy 32m — completion30 delivered, advise-only", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 28 * 60 * 1000);
  // Jump: supersede lower elapsed, deliver completion30
  const r = deliver(state, 1_000_000 + 32 * 60 * 1000);
  assert.ok(hasKind(r.interventions, "completion30"), decisionText(r.interventions));
  assert.equal(getDeliveryStatus(state, "status10"), "superseded");
  const resp = buildHookResponse("preToolUse", r.interventions, state, {});
  assert.equal(resp.permission, "allow");
});

test("G. 36m — force35 once with D-66 guidance", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 30 * 60 * 1000);
  const r = deliver(state, 1_000_000 + 36 * 60 * 1000);
  assert.ok(hasKind(r.interventions, "force35"));
  assert.match(r.interventions[0].decision, /D-66/);
  const r2 = deliver(state, 1_000_000 + 36 * 60 * 1000 + 1000);
  assert.equal(hasKind(r2.interventions, "force35"), false);
});

// --- Delivery reliability H–K ---
test("H. due on unreliable hook → pending, not consumed", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  const r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "echo ok",
      output: "ok PASS",
      duration: 10,
    },
    1_000_000 + 12 * 60 * 1000
  );
  assert.equal(r.interventions.length, 0);
  assert.equal(r.pendingOnly, true);
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
});

test("I. next reliable hook delivers pending then marks delivered", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  evaluate(
    state,
    {
      hook_event_name: "afterFileEdit",
      file_path: "/workspace/src/x.ts",
    },
    1_000_000 + 12 * 60 * 1000
  );
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  const r = deliver(state, 1_000_000 + 12 * 60 * 1000 + 1000, "postToolUse");
  assert.ok(hasKind(r.interventions, "status10"));
  assert.equal(getDeliveryStatus(state, "status10"), "delivered");
  const resp = buildHookResponse("postToolUse", r.interventions, state, {});
  assert.ok(resp.additional_context);
});

test("J. multiple unreliable hooks after due — no loss, no duplicate delivery", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  for (let i = 0; i < 3; i++) {
    const r = evaluate(
      state,
      {
        hook_event_name: "afterShellExecution",
        command: `echo ${i}`,
        output: "PASS",
        duration: 5,
      },
      1_000_000 + 12 * 60 * 1000 + i * 100
    );
    assert.equal(r.interventions.length, 0);
    assert.equal(getDeliveryStatus(state, "status10"), "pending");
  }
  const r = deliver(state, 1_000_000 + 12 * 60 * 1000 + 500);
  assert.equal(r.interventions.filter((i) => i.kind === "status10").length, 1);
  const r2 = deliver(state, 1_000_000 + 12 * 60 * 1000 + 600);
  assert.equal(hasKind(r2.interventions, "status10"), false);
});

test("K. several checkpoints pending — emit highest only (policy B)", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  // Jump to 21m on unreliable → queue status10, focus15, focus20 as pending via observe
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "echo late",
      output: "PASS",
      duration: 5,
    },
    1_000_000 + 21 * 60 * 1000
  );
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  assert.equal(getDeliveryStatus(state, "focus15"), "pending");
  assert.equal(getDeliveryStatus(state, "focus20"), "pending");
  const r = deliver(state, 1_000_000 + 21 * 60 * 1000 + 50);
  assert.equal(r.interventions.length, 1);
  assert.equal(r.interventions[0].kind, "focus20");
  assert.equal(getDeliveryStatus(state, "status10"), "superseded");
  assert.equal(getDeliveryStatus(state, "focus15"), "superseded");
  assert.equal(getDeliveryStatus(state, "focus20"), "delivered");
});

test("L. same command fails twice — thrash delivered, permission allow, D-19/D-50", () => {
  const state = fresh();
  const cmd = "npm run verify:pickup";
  const out = "FAIL Error: boom";
  shellFail(state, 1_000_000, cmd, out);
  shellFail(state, 1_000_100, cmd, out);
  assert.ok(
    Object.keys(state.delivery).some(
      (k) => k.startsWith("thrash:") && state.delivery[k].status === "pending"
    )
  );
  const r = deliver(state, 1_000_200, "beforeShellExecution");
  assert.ok(r.interventions.some((i) => i.kind.startsWith("thrash:")));
  const resp = buildHookResponse("beforeShellExecution", r.interventions, state, {});
  assert.equal(resp.permission, "allow");
  assert.match(r.interventions[0].decision, /D-19\/D-50/);
});

test("M. 10m no progress — stall10 delivered; status10 distinct", () => {
  const state = fresh(1_000_000);
  // No progress edits; at 10m both stall10 and status10 become due
  evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "echo idle",
      output: "ok",
      duration: 5,
    },
    1_000_000 + 10 * 60 * 1000
  );
  assert.equal(getDeliveryStatus(state, "stall10"), "pending");
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  const r = deliver(state, 1_000_000 + 10 * 60 * 1000 + 100);
  assert.ok(hasKind(r.interventions, "stall10"));
  assert.ok(hasKind(r.interventions, "status10"));
  assert.equal(getDeliveryStatus(state, "stall10"), "delivered");
  assert.equal(getDeliveryStatus(state, "status10"), "delivered");
});

test("N. same wait kind x3 — wait_poll works", () => {
  const state = fresh();
  const cmd = "gh run list";
  for (let i = 0; i < 3; i++) {
    evaluate(
      state,
      {
        hook_event_name: "afterShellExecution",
        command: cmd,
        output: "in_progress pending",
        duration: 100,
      },
      1_000_000 + i * 1000
    );
  }
  const r = deliver(state, 1_004_000);
  assert.ok(r.interventions.some((i) => i.kind.startsWith("wait_poll:")));
});

test("O. new conversation — state resets by conversation_id", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-"));
  try {
    const a = loadState("conv-a", [dir], 1_000_000);
    queuePending(a, 1_000_000, "status10", { ...ELAPSED_CHECKPOINT_COPY.status10 }, "elapsed");
    saveState(a, [dir]);
    const b = loadState("conv-b", [dir], 1_000_000);
    assert.equal(getDeliveryStatus(b, "status10"), "not_due");
    assert.equal(b.conversationId, "conv-b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P. fail-open contract — empty response never denies; pending not falsely delivered on best-effort", () => {
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  const r = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "echo x",
      output: "PASS",
      duration: 1,
    },
    1_000_000 + 12 * 60 * 1000
  );
  assert.equal(r.interventions.length, 0);
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  const resp = buildHookResponse("afterShellExecution", [], state, {});
  assert.equal(resp.permission, undefined);
  assert.equal(responseCarriesAdvice(resp), false);
  // permission hooks always allow
  const allow = buildHookResponse("preToolUse", [], state, {});
  assert.equal(allow.permission, "allow");
});

// --- Realistic simulated long session ---
test("simulated long session: unreliable→reliable cadence with healthy progress", () => {
  const t0 = 1_000_000;
  const state = fresh(t0);
  const visible = [];

  function step(label, advanceMin, hook, eventExtra = {}) {
    const now = t0 + advanceMin * 60 * 1000;
    if (hook === "afterFileEdit") {
      progressEdit(state, now, `${label}.ts`);
      return;
    }
    const event = {
      hook_event_name: hook,
      ...eventExtra,
    };
    if (hook === "afterShellExecution") {
      event.command = event.command || `echo ${label}`;
      event.output = event.output || "PASS";
      event.duration = 10;
    }
    if (hook === "preToolUse" || hook === "postToolUse") {
      event.tool_name = event.tool_name || "Read";
      event.tool_input = event.tool_input || {};
    }
    const r = evaluate(state, event, now);
    for (const i of r.interventions) visible.push({ min: advanceMin, kind: i.kind, hook });
  }

  step("start", 0, "preToolUse");
  step("p5", 5, "afterFileEdit");
  step("due10-unreliable", 10, "afterShellExecution");
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  step("del10", 11, "preToolUse");
  step("p14", 14, "afterFileEdit");
  step("due15-unreliable", 15, "afterShellExecution");
  step("del15", 16, "postToolUse");
  step("p19", 19, "afterFileEdit");
  step("due20-unreliable", 20, "afterFileEdit");
  // afterFileEdit at 20m queues focus20 as pending (unreliable)
  assert.equal(getDeliveryStatus(state, "focus20"), "pending");
  step("del20", 21, "preToolUse");
  step("p24", 24, "afterFileEdit");
  step("due25-unreliable", 25, "afterShellExecution");
  step("del25", 26, "beforeShellExecution");
  step("p29", 29, "afterFileEdit");
  step("due30-unreliable", 30, "afterShellExecution");
  step("del30", 31, "preToolUse");
  step("p34", 34, "afterFileEdit");
  step("due35-unreliable", 35, "afterShellExecution");
  step("del35", 36, "stop");

  const kinds = visible.map((v) => v.kind);
  assert.deepEqual(kinds, [
    "status10",
    "focus15",
    "focus20",
    "focus25",
    "completion30",
    "force35",
  ]);
  assert.equal(visible.every((v) => isReliableDeliveryHook(v.hook)), true);
  assert.equal(getDeliveryStatus(state, "stall10"), "not_due");
  console.log("   long-session visible:", kinds.join(" → "));
});

test("before/after: unreliable no longer consumes checkpoint", () => {
  // AFTER behavior (this implementation)
  const state = fresh(1_000_000);
  progressEdit(state, 1_000_000 + 5 * 60 * 1000);
  const unreliable = evaluate(
    state,
    {
      hook_event_name: "afterShellExecution",
      command: "npm run build",
      output: "build succeeded PASS",
      duration: 100,
    },
    1_000_000 + 12 * 60 * 1000
  );
  assert.equal(unreliable.interventions.length, 0, "AFTER: no consume on unreliable");
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
  const reliable = deliver(state, 1_000_000 + 12 * 60 * 1000 + 1);
  assert.ok(hasKind(reliable.interventions, "status10"), "AFTER: delivered on reliable");
  // Document BEFORE: fireOnce on afterShell would have set fired=true with empty/best-effort inject
  console.log(
    "   BEFORE: fireOnce on afterShellExecution could mark fired without agent-visible field"
  );
  console.log(
    "   AFTER: status=pending until preToolUse/postToolUse/beforeShellExecution/stop delivers"
  );
});

test("selectPendingForDelivery empty on unreliable even if pending", () => {
  const state = fresh(1_000_000);
  queuePending(state, 1_000_000, "status10", { ...ELAPSED_CHECKPOINT_COPY.status10 }, "elapsed");
  const selected = selectPendingForDelivery(state, "afterShellExecution", 1_000_000);
  assert.equal(selected.length, 0);
  assert.equal(getDeliveryStatus(state, "status10"), "pending");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
