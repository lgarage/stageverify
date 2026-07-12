#!/usr/bin/env node
/**
 * Demo verify-failure learning capture → packet gateWarning injection.
 * Run: npm run indexer:demo-verify-failure [--assert]
 */
import {
  collectIndexerGateWarnings,
  mergeGateWarnings,
  normalizeIngestInput,
} from "./lib/indexer-ingest-lib.mjs";
import { matchTriggers, buildGotchaResult, loadGotchaMap } from "./lib/gotcha-map-lib.mjs";
import {
  captureVerifyFailure,
  classifyVerifyFailure,
  clearPendingForScript,
  pendingToIngestInput,
  validatePendingLearnings,
} from "./lib/verify-learning-hook.mjs";

const assertMode = process.argv.includes("--assert");

/** @type {string[]} */
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// --- Case 1: simulated stale gh-pages prod failure → valid pending structure (dry-run) ---
const simulatedStderr = `
ASSERT FAILED: expected "All Items Picked Up!" but got old UI text
verify:pickup:prod — prod bundle may be stale; redeploy gh-pages first
`;
const captureResult = captureVerifyFailure({
  scriptName: "verify:pickup:prod",
  exitCode: 1,
  stderrTail: simulatedStderr,
  stdoutTail: "",
  forwardArgs: ["--base-url=https://lgarage.github.io/stageverify"],
  dryRun: true,
});

assert(
  captureResult.action === "pending-capture",
  `expected pending-capture; got ${captureResult.action}`,
);
assert(
  captureResult.entry?.gateCandidate === true,
  "expected gateCandidate true for prod stale failure",
);
assert(
  captureResult.entry?.category === "gotcha",
  `expected gotcha category; got ${captureResult.entry?.category}`,
);
assert(
  (captureResult.entry?.triggerTerms ?? []).some((t) => /gh-pages|prod verify|stale/i.test(t)),
  "expected gh-pages/prod/stale trigger terms",
);

// --- Case 2: pending entry normalizes and injects gateWarning in future packet ---
if (captureResult.entry) {
  const ingestInput = pendingToIngestInput(captureResult.entry);
  const normalized = normalizeIngestInput(ingestInput);
  const typeKey =
    normalized.type && normalized.subtype
      ? `${normalized.type}/${normalized.subtype}`
      : normalized.type ?? null;

  /** @type {import("./lib/indexer-ingest-lib.mjs").IndexerMemoryEntry} */
  const demoIndexerEntry = {
    id: "idx-demo-verify-failure",
    ...normalized,
    createdAt: new Date().toISOString(),
  };

  const taskQuery =
    "Pickup portal prod verify after UI ship verify:pickup:prod stale gh-pages bundle";
  const gateWarnings = collectIndexerGateWarnings(taskQuery, typeKey, [demoIndexerEntry]);

  assert(gateWarnings.length > 0, "expected gateWarnings from auto-captured pending entry");
  assert(
    String(gateWarnings[0] ?? "").toLowerCase().includes("stale") ||
      String(gateWarnings[0] ?? "").toLowerCase().includes("gh-pages"),
    "gate warning should mention stale/gh-pages",
  );

  const map = loadGotchaMap();
  const matched = matchTriggers(taskQuery, map.triggers ?? []);
  const gotchaBase = buildGotchaResult(matched, map.orchestratorSteps ?? {});
  const mergedWarnings = mergeGateWarnings(
    /** @type {string[]} */ (gotchaBase.gateWarnings ?? []),
    gateWarnings,
  );
  assert(
    mergedWarnings.length > 0,
    `expected merged gateWarnings (gotcha + indexer); got none`,
  );
}

// --- Case 3: session dedup — same fingerprint twice ---
const dedup1 = captureVerifyFailure({
  scriptName: "verify:pickup:prod",
  exitCode: 1,
  stderrTail: simulatedStderr,
  stdoutTail: "",
  forwardArgs: ["--base-url=https://lgarage.github.io/stageverify"],
  dryRun: true,
});
const dedup2 = captureVerifyFailure({
  scriptName: "verify:pickup:prod",
  exitCode: 1,
  stderrTail: simulatedStderr,
  stdoutTail: "",
  forwardArgs: ["--base-url=https://lgarage.github.io/stageverify"],
  dryRun: true,
});
assert(
  dedup2.action === "dedup-session" || dedup2.action === "dedup-pending",
  `expected dedup on retry; got ${dedup2.action}`,
);

// --- Case 4: negative — unrelated backend task should not get pickup-specific warning from demo entry ---
const classified = classifyVerifyFailure({
  scriptName: "verify:phase4-integration:prod",
  exitCode: 1,
  stderrTail: "firestore rules emulator connection refused",
  stdoutTail: "",
  isProd: true,
  domain: "verify",
});
assert(
  !classified.summary.toLowerCase().includes("pickup"),
  "unrelated integration failure should not mention pickup",
);
assert(
  !classified.summary.toLowerCase().includes("stale") &&
    !classified.summary.toLowerCase().includes("redeploy"),
  `backend integration prod failure should not suggest stale gh-pages redeploy; got: ${classified.summary}`,
);
assert(
  classified.gateCandidate === false,
  "backend integration prod failure should not be gateCandidate",
);

// --- Case 5: clearPendingForScript dry-run ---
const clearResult = clearPendingForScript("verify:pickup:prod", { dryRun: true });
assert(
  typeof clearResult.removed === "number",
  "clearPendingForScript should return removed count",
);

// --- Case 6: pending entry has source + root-cause notes on ingest ---
if (captureResult.entry) {
  assert(
    captureResult.entry.source === "verify-auto-capture",
    "pending entry should have source verify-auto-capture",
  );
  const ingestInput = pendingToIngestInput(captureResult.entry);
  assert(
    ingestInput.tags?.includes("verify-auto-capture"),
    "ingest input should tag verify-auto-capture",
  );
  assert(
    ingestInput.notes?.toLowerCase().includes("mitigation"),
    "gateCandidate ingest should include mitigation notes",
  );
}

// --- Case 7: validatePendingLearnings on empty store ---
const { errors: pendingErrors } = validatePendingLearnings();
assert(pendingErrors.length === 0, `validatePendingLearnings errors: ${pendingErrors.join("; ")}`);

// --- Case 8: spawnSync patch child timeout (D-18 Phase 0 — not generic Playwright timeout) ---
const spawnPatchStderr = `
Error: scripts/patch-phase4-release-e2e-fixture.mjs timed out after 120s
    at runPatchScript (file:///C:/Projects/stageverify/scripts/verify-location-phase4.mjs:53:11)
`;
const spawnPatchStdout = `
=== patch phase4 release E2E fixture ===
[patch-phase4-release] signing in…
[patch-phase4-release] sign-in OK
[patch-phase4-release] committing batch…
Phase 4 release E2E fixture: planned G1 only on delivery-demo-vendor-1; pipe-a adjacency on G2+GL.
`;
const spawnClassified = classifyVerifyFailure({
  scriptName: "verify:location-phase4",
  exitCode: 1,
  stderrTail: spawnPatchStderr,
  stdoutTail: spawnPatchStdout,
  isProd: false,
  domain: "verify",
});
assert(
  spawnClassified.category === "gotcha",
  `spawn patch timeout should be gotcha; got ${spawnClassified.category}`,
);
assert(
  spawnClassified.gateCandidate === true,
  "spawn patch timeout should be gateCandidate",
);
assert(
  spawnClassified.summary.toLowerCase().includes("process.exit"),
  `spawn patch summary should mention process.exit; got: ${spawnClassified.summary}`,
);
assert(
  (spawnClassified.triggerTerms ?? []).some((t) => /spawn-child-timeout|spawn-sync|process\.exit/i.test(t)),
  "spawn patch should include spawn-child-timeout trigger terms",
);
assert(
  !spawnClassified.summary.toLowerCase().includes("playwright timeout"),
  "spawn patch should not classify as generic Playwright timeout",
);

// --- Case 9: auth OK in stdout must not false-positive auth failure (vfl-014 misclass) ---
const authOkClassified = classifyVerifyFailure({
  scriptName: "verify:location-phase4",
  exitCode: 1,
  stderrTail: null,
  stdoutTail:
    "[verify] ensureAuthenticated…\n[verify] dispatcher auth OK\nFAIL: ORD-005 Divergence badge in list — missing",
  isProd: false,
  domain: "verify",
});
assert(
  !authOkClassified.summary.toLowerCase().includes("auth failure"),
  `auth OK stdout should not classify as auth failure; got: ${authOkClassified.summary}`,
);

const authFailClassified = classifyVerifyFailure({
  scriptName: "verify:dispatcher-nav",
  exitCode: 1,
  stderrTail: "FirebaseError: auth/user-token-expired",
  stdoutTail: "[verify] ensureAuthenticated…\n[verify] login required — run playwright-auth-setup.mjs",
  isProd: false,
  domain: "dispatcher",
});
assert(
  authFailClassified.category === "lesson",
  `real auth failure should classify as lesson; got ${authFailClassified.category}`,
);
assert(
  authFailClassified.summary.toLowerCase().includes("auth"),
  `real auth failure summary should mention auth; got: ${authFailClassified.summary}`,
);

// --- Case 10: hideSeedDemoRows View-button timeout (phase14 prod) — not stale bundle ---
const hideSeedStdout = `FAIL: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('button').filter({ hasText: /^View$/ }).first()

FAIL: reset pickup fixture (exit 1)
FAIL: §14 legs 3–22 prod core loop (exit 1)
`;
const hideSeedClassified = classifyVerifyFailure({
  scriptName: "verify:phase14-e2e:prod",
  exitCode: 1,
  stderrTail: "",
  stdoutTail: hideSeedStdout,
  isProd: true,
  domain: "dispatcher",
});
assert(
  hideSeedClassified.category === "gotcha",
  `hideSeed View timeout should be gotcha; got ${hideSeedClassified.category}`,
);
assert(
  hideSeedClassified.gateCandidate === true,
  "hideSeed View timeout should be gateCandidate",
);
assert(
  /hideseeddemorows|opendelivery/i.test(hideSeedClassified.summary),
  `hideSeed summary should mention hideSeedDemoRows/openDelivery; got: ${hideSeedClassified.summary}`,
);
assert(
  !hideSeedClassified.summary.toLowerCase().includes("stale gh-pages"),
  "hideSeed should not classify as stale gh-pages bundle",
);
assert(
  (hideSeedClassified.triggerTerms ?? []).some((t) =>
    /hideseeddemorows|prod-verify-hide-seed-demo/i.test(t),
  ),
  "hideSeed should include hideSeedDemoRows trigger terms",
);

const hideSeedLocalClassified = classifyVerifyFailure({
  scriptName: "verify:phase14-e2e",
  exitCode: 1,
  stderrTail: "",
  stdoutTail: hideSeedStdout,
  isProd: false,
  domain: "dispatcher",
});
assert(
  !/hideseeddemorows/i.test(hideSeedLocalClassified.summary),
  `local View timeout must not classify as hideSeedDemoRows; got: ${hideSeedLocalClassified.summary}`,
);

const spawnPatchCapture = captureVerifyFailure({
  scriptName: "verify:location-phase4",
  exitCode: 1,
  stderrTail: spawnPatchStderr,
  stdoutTail: spawnPatchStdout,
  dryRun: true,
});
assert(
  spawnPatchCapture.entry?.summary?.toLowerCase().includes("process.exit"),
  "spawn patch capture should record process.exit summary",
);
assert(
  spawnPatchCapture.entry?.gateCandidate === true,
  "spawn patch capture should set gateCandidate",
);

const spawnTaskQuery =
  "verify location phase4 spawnSync patch child timed out process.exit patch-phase4";
const gotchaMap = loadGotchaMap();
const spawnMatched = matchTriggers(spawnTaskQuery, gotchaMap.triggers ?? []);
assert(
  spawnMatched.some((t) => t.id === "spawn-sync-patch-exit"),
  "gotcha-map should match spawn-sync-patch-exit for patch timeout task",
);

const payload = {
  _demo: true,
  capture: {
    action: captureResult.action,
    id: captureResult.entry?.id,
    category: captureResult.entry?.category,
    gateCandidate: captureResult.entry?.gateCandidate,
    triggerTerms: captureResult.entry?.triggerTerms,
    summary: captureResult.entry?.summary,
  },
  dedup: { first: dedup1.action, second: dedup2.action },
  ok: failures.length === 0,
  failures,
};

console.log(JSON.stringify(payload, null, 2));

if (assertMode && failures.length > 0) {
  console.error(`\nindexer:demo-verify-failure ASSERT FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (failures.length > 0) process.exit(1);
