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
  domain: "integration",
});
assert(
  !classified.summary.toLowerCase().includes("pickup"),
  "unrelated integration failure should not mention pickup",
);

// --- Case 5: validatePendingLearnings on empty store ---
const { errors: pendingErrors } = validatePendingLearnings();
assert(pendingErrors.length === 0, `validatePendingLearnings errors: ${pendingErrors.join("; ")}`);

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
