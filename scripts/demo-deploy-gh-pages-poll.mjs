#!/usr/bin/env node
/**
 * Demo / unit-style tests for deploy-gh-pages poll state machine (no gh CLI, no network).
 * Run: npm run demo:deploy-gh-pages-poll [--assert]
 */
import {
  DEFAULTS,
  createPagesPollState,
  evaluatePagesPoll,
  runMockPollSequence,
  compareLiveBundle,
  isGhAuthError,
  formatGhAuthFailureMessage,
  inferDeployFailureKind,
} from "./lib/deploy-gh-pages-lib.mjs";

const assertMode = process.argv.includes("--assert");
/** @type {string[]} */
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const { BUILDING_STUCK_MS, POLL_MS } = DEFAULTS;
const T0 = 1_000_000_000_000;
const COMMIT = "abc1234567890";

function build(status, errMsg) {
  return {
    status,
    commit: COMMIT,
    ...(errMsg ? { error: { message: errMsg } } : {}),
  };
}

// --- Case 1: already built (no rebuild) ---
{
  const state = createPagesPollState(T0 + 300_000, T0);
  const r = evaluatePagesPoll({
    state,
    build: build("built"),
    now: T0 + 12_000,
    expectedAsset: "/stageverify/assets/index-new.js",
  });
  assert(r.action === "success", `case1: expected success, got ${r.action}`);
  assert(r.nextState.postCount === 0, "case1: no POST on already-built");
}

// --- Case 2: building → built within normal window ---
{
  const result = await runMockPollSequence({
    builds: [build("building"), build("building"), build("built")],
    pollMs: POLL_MS,
    timeoutMs: 300_000,
    startNow: T0,
    expectedAsset: "/stageverify/assets/index-new.js",
  });
  assert(result.success, "case2: building→built should succeed");
  assert(!result.rebuildTriggered, "case2: no rebuild in normal window");
}

// --- Case 3: building past threshold → stuck rebuild → built ---
{
  const rebuildReasons = [];
  const stuckPolls = Math.ceil(BUILDING_STUCK_MS / POLL_MS) + 1;
  /** @type {Array<{ status: string, commit?: string }>} */
  const builds = [];
  for (let i = 0; i < stuckPolls; i++) builds.push(build("building"));
  builds.push(build("building"));
  builds.push(build("built"));

  const result = await runMockPollSequence({
    builds,
    pollMs: POLL_MS,
    timeoutMs: 300_000,
    buildingStuckMs: BUILDING_STUCK_MS,
    startNow: T0,
    expectedAsset: "/stageverify/assets/index-new.js",
    onRebuild: (reason) => rebuildReasons.push(reason),
  });
  assert(result.rebuildTriggered, "case3: should trigger stuck rebuild");
  assert(rebuildReasons.includes("stuck-building"), "case3: reason=stuck-building");
  assert(result.stuckRebuildUsed, "case3: stuckRebuildUsed flag set");
  assert(result.postCount === 1, `case3: exactly one POST, got ${result.postCount}`);
  assert(result.success, "case3: should succeed after rebuild");
}

// --- Case 4: stuck rebuild still building at timeout → fail ---
{
  const stuckPolls = Math.ceil(BUILDING_STUCK_MS / POLL_MS) + 1;
  /** @type {Array<{ status: string }>} */
  const builds = [];
  for (let i = 0; i < 30; i++) builds.push(build("building"));

  const result = await runMockPollSequence({
    builds,
    pollMs: POLL_MS,
    timeoutMs: 300_000,
    buildingStuckMs: BUILDING_STUCK_MS,
    startNow: T0,
  });
  assert(!result.success, "case4: should fail on timeout");
  assert(result.rebuildTriggered, "case4: stuck rebuild should have fired");
  assert(result.failKind === "timeout", `case4: failKind timeout, got ${result.failKind}`);
  assert(
    (result.failMessage ?? "").includes("Do NOT re-run npm run deploy"),
    "case4: timeout message should say do not re-run deploy",
  );
}

// --- Case 5: errored → one errored rebuild → built ---
{
  const rebuildReasons = [];
  const result = await runMockPollSequence({
    builds: [build("errored", "build failed"), build("building"), build("built")],
    pollMs: POLL_MS,
    timeoutMs: 300_000,
    startNow: T0 + 100_000,
  });
  assert(result.rebuildTriggered, "case5: errored should trigger rebuild");
  assert(result.erroredRebuildUsed, "case5: erroredRebuildUsed set");
  assert(result.success, "case5: should succeed after errored rebuild");
}

// --- Case 6: errored then stuck building allows second POST (max 2) ---
{
  let state = createPagesPollState(T0 + 300_000, T0);
  let r = evaluatePagesPoll({ state, build: build("errored"), now: T0 + 12_000 });
  assert(r.action === "trigger-rebuild" && r.reason === "errored", "case6a: errored POST");
  state = r.nextState;

  // Advance building duration across polls (buildingStartedAt set on first building poll)
  const buildingStart = T0 + 24_000;
  state = { ...state, buildingStartedAt: buildingStart };
  r = evaluatePagesPoll({
    state,
    build: build("building"),
    now: buildingStart + BUILDING_STUCK_MS,
    buildingStuckMs: BUILDING_STUCK_MS,
  });
  assert(r.action === "trigger-rebuild" && r.reason === "stuck-building", "case6b: stuck POST after errored");
  assert(r.nextState.postCount === 2, "case6b: postCount=2");
}

// --- Case 7: no second stuck POST ---
{
  let state = createPagesPollState(T0 + 300_000, T0);
  state.stuckRebuildUsed = true;
  state.postCount = 1;
  state.buildingStartedAt = T0;

  const r = evaluatePagesPoll({
    state,
    build: build("building"),
    now: T0 + BUILDING_STUCK_MS + 60_000,
    buildingStuckMs: BUILDING_STUCK_MS,
  });
  assert(r.action === "continue", "case7: no second stuck POST");
}

// --- Case 8: live bundle compare ---
{
  const ok = compareLiveBundle("/stageverify/assets/a.js", "/stageverify/assets/a.js");
  assert(ok.ok, "case8: matching assets ok");
  const bad = compareLiveBundle("/stageverify/assets/new.js", "/stageverify/assets/old.js");
  assert(!bad.ok && bad.message.includes("Do NOT re-run"), "case8: stale message");
}

// --- Case 9: auth error detection ---
{
  assert(isGhAuthError("HTTP 401: Bad credentials"), "case9: 401");
  assert(isGhAuthError("To authenticate, run: gh auth login"), "case9: auth login hint");
  const msg = formatGhAuthFailureMessage("HTTP 401");
  assert(msg.includes("gh auth login"), "case9: auth fix steps");
  assert(msg.includes("POST repos/lgarage/stageverify/pages/builds"), "case9: manual POST");
  assert(inferDeployFailureKind(msg) === "auth-failed", "case9: auth-failed kind");
}

const payload = {
  _demo: true,
  cases: 9,
  ok: failures.length === 0,
  failures,
  constants: {
    POLL_MS: DEFAULTS.POLL_MS,
    TIMEOUT_MS: DEFAULTS.TIMEOUT_MS,
    BUILDING_STUCK_MS: DEFAULTS.BUILDING_STUCK_MS,
  },
};

console.log(JSON.stringify(payload, null, 2));

if (assertMode && failures.length > 0) {
  console.error(`\ndemo:deploy-gh-pages-poll ASSERT FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (failures.length > 0) process.exit(1);
