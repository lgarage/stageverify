#!/usr/bin/env node
/**
 * Demo deploy-failure learning capture → packet gateWarning injection.
 * Run: npm run indexer:demo-deploy-failure [--assert]
 */
import fs from "node:fs";
import { mergeGateWarnings } from "./lib/indexer-ingest-lib.mjs";
import { matchTriggers, buildGotchaResult, loadGotchaMap } from "./lib/gotcha-map-lib.mjs";
import {
  captureDeployFailure,
  classifyDeployFailure,
  collectPendingLearningGateWarnings,
  LEARNING_PENDING_PATH,
  loadPendingLearnings,
  pendingToIngestInput,
  savePendingLearnings,
  validatePendingLearnings,
} from "./lib/verify-learning-hook.mjs";

const assertMode = process.argv.includes("--assert");

/** @type {string[]} */
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// --- Case 1: simulated deploy timeout → valid pending structure (dry-run) ---
const simulatedLog = `
deploy: pushing dist/ to gh-pages branch…
deploy: gh-pages branch push complete
deploy: Pages build status: queued
deploy: Pages build status: building
deploy: FAIL — timed out after 300s waiting for Pages build status=built (last: building)
`;
const captureResult = captureDeployFailure({
  exitCode: 1,
  failureKind: "timeout",
  message: "timed out after 300s waiting for Pages build status=built (last: building)",
  stderrTail: simulatedLog,
  stdoutTail: "",
  dryRun: true,
});

assert(
  captureResult.action === "pending-capture",
  `expected pending-capture; got ${captureResult.action}`,
);
assert(
  captureResult.entry?.gateCandidate === true,
  "expected gateCandidate true for deploy timeout",
);
assert(
  captureResult.entry?.category === "gotcha",
  `expected gotcha category; got ${captureResult.entry?.category}`,
);
assert(
  captureResult.entry?.source === "deploy-auto-capture",
  "expected source deploy-auto-capture",
);
assert(
  (captureResult.entry?.triggerTerms ?? []).some((t) => /deploy timeout|pages build|gh-pages/i.test(t)),
  "expected deploy/gh-pages trigger terms",
);
assert(
  !captureResult.entry?.summary.toLowerCase().includes("typescript") &&
    !captureResult.entry?.summary.toLowerCase().includes("build error"),
  "deploy learning should describe propagation, not code failure",
);

// --- Case 2: stuck building (13d9110) → branch/live mismatch terms ---
const stuckBuildingLog = `
deploy: gh-pages branch push complete
deploy: Pages build status: queued
deploy: Pages build status: building
deploy: FAIL — timed out after 1740s waiting for Pages build status=built (last: building)
`;
const stuckResult = classifyDeployFailure({
  exitCode: 1,
  failureKind: "timeout",
  message: "timed out after 1740s waiting for Pages build status=built (last: building)",
  stderrTail: stuckBuildingLog,
  stdoutTail: "",
});
assert(
  stuckResult.summary.toLowerCase().includes("stuck") ||
    stuckResult.summary.toLowerCase().includes("branch"),
  "stuck-building timeout should mention stuck building or branch/live mismatch",
);
assert(
  (stuckResult.triggerTerms ?? []).some((t) => /pages build stuck|old bundle/i.test(t)),
  "stuck-building should emit Pages build stuck or old-bundle trigger terms",
);

// --- Case 3: stale bundle classification ---
const staleClassified = classifyDeployFailure({
  exitCode: 1,
  failureKind: "stale-bundle",
  message:
    "live bundle mismatch — expected /stageverify/assets/index-abc.js, live has /stageverify/assets/index-old.js",
  stderrTail: "deploy: live bundle mismatch",
  stdoutTail: "",
});
assert(
  staleClassified.summary.toLowerCase().includes("live bundle mismatch") ||
    staleClassified.summary.toLowerCase().includes("live index"),
  "stale-bundle should mention live bundle/index asset",
);

// --- Case 4: pending entry injects gateWarning for frontend deploy/prod task ---
if (captureResult.entry) {
  const ingestInput = pendingToIngestInput(captureResult.entry);
  assert(
    ingestInput.notes?.toLowerCase().includes("mitigation"),
    "deploy gateCandidate ingest should include mitigation notes",
  );

  const frontendTask =
    "Ship Invoice Review UI — npm run deploy then verify:invoice-review:prod gh-pages";
  const backendTask =
    "Backend firestore rules hardening — rules-only change, no frontend bundle";

  const backup = fs.existsSync(LEARNING_PENDING_PATH)
    ? fs.readFileSync(LEARNING_PENDING_PATH, "utf8")
    : null;
  try {
    const store = loadPendingLearnings();
    store.entries = store.entries.filter((e) => e.mergedAt || e.id !== captureResult.entry?.id);
    store.entries.push({ ...captureResult.entry, id: "dfl-demo-001" });
    savePendingLearnings(store);

    const frontendWarnings = collectPendingLearningGateWarnings(
      frontendTask,
      "ui-component/layout-style",
    );
    assert(frontendWarnings.length > 0, "expected pending deploy warning for frontend task");
    assert(
      String(frontendWarnings[0] ?? "").toLowerCase().includes("timeout") ||
        String(frontendWarnings[0] ?? "").toLowerCase().includes("bundle") ||
        String(frontendWarnings[0] ?? "").toLowerCase().includes("deploy"),
      "frontend warning should mention deploy/propagation",
    );

    const backendWarnings = collectPendingLearningGateWarnings(
      backendTask,
      "backend-write-critical/firestore-read",
    );
    assert(backendWarnings.length === 0, "backend task should not get deploy pending warnings");

    const map = loadGotchaMap();
    const matched = matchTriggers(frontendTask, map.triggers ?? []);
    const matchedIds = matched.map((t) => t.id);
    const gotchaBase = buildGotchaResult(matched, map.orchestratorSteps ?? {});
    const mergedWarnings = mergeGateWarnings(
      /** @type {string[]} */ (gotchaBase.gateWarnings ?? []),
      frontendWarnings,
    );
    assert(
      matchedIds.includes("gh-pages-deploy-freshness") || matchedIds.includes("prod-verify-redeploy"),
      `expected gh-pages deploy gotcha match; got ${matchedIds.join(", ") || "none"}`,
    );
    assert(mergedWarnings.length > 0, "expected merged gateWarnings (gotcha + pending deploy)");
  } finally {
    if (backup !== null) fs.writeFileSync(LEARNING_PENDING_PATH, backup);
  }
}

// --- Case 5: real 751761 transcript (300s timeout while building) ---
const jul5DeployLog = `
deploy: wrote dist/.nojekyll
deploy: pushing dist/ to gh-pages branch…
deploy: gh-pages branch push complete
deploy: Pages build status: building
deploy: FAIL — timed out after 300s waiting for Pages build status=built (last: building)
deploy-learning: captured pending dfl-001 (gotcha) — npm run deploy timed out or Pages build stuck building
`;
const jul5Classified = classifyDeployFailure({
  exitCode: 1,
  failureKind: "timeout",
  message: "timed out after 300s waiting for Pages build status=built (last: building)",
  stderrTail: jul5DeployLog,
  stdoutTail: "",
});
assert(
  jul5Classified.summary.toLowerCase().includes("300s") ||
    jul5Classified.summary.toLowerCase().includes("script timeout"),
  "751761-style 300s timeout should mention script timeout or 300s",
);
assert(
  (jul5Classified.triggerTerms ?? []).some((t) => /300s|deploy script timeout|long deploy/i.test(t)),
  "751761 transcript should emit deploy-script-timeout trigger terms",
);

// --- Case 6: session dedup ---
const dedup1 = captureDeployFailure({
  exitCode: 1,
  failureKind: "timeout",
  message: simulatedLog,
  stderrTail: simulatedLog,
  dryRun: true,
});
const dedup2 = captureDeployFailure({
  exitCode: 1,
  failureKind: "timeout",
  message: simulatedLog,
  stderrTail: simulatedLog,
  dryRun: true,
});
assert(
  dedup2.action === "dedup-session" || dedup2.action === "dedup-pending",
  `expected dedup on retry; got ${dedup2.action}`,
);

// --- Case 7: validatePendingLearnings ---
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
    source: captureResult.entry?.source,
  },
  dedup: { first: dedup1.action, second: dedup2.action },
  ok: failures.length === 0,
  failures,
};

console.log(JSON.stringify(payload, null, 2));

if (assertMode && failures.length > 0) {
  console.error(`\nindexer:demo-deploy-failure ASSERT FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

if (failures.length > 0) process.exit(1);
