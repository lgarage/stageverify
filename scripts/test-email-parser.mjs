/**
 * Email parser/matcher fixture tests (offline).
 * Run: npm run test:email-parser
 *
 * Phase 5 ≥95% gate (roadmap): each approved fixture has defined expected fields;
 * a fixture passes when all expectations match; aggregate accuracy = passed/total.
 * Gate threshold: 95% on the full approved sample set (excluding duplicate-skip rows).
 */

import { processInboundEmail } from "../src/dispatcher/email/processEmailMessage.ts";
import {
  EMAIL_FIXTURES,
  MULTI_VENDOR_MATCH_CONTEXT,
} from "../src/dispatcher/email/emailFixtures.ts";

const ACCURACY_GATE = 95;

/** @typedef {{ label: string, pass: boolean, detail?: string }} ExpectResult */

/**
 * @param {import("../src/dispatcher/email/types.ts").EmailProcessingResult} result
 * @param {Record<string, unknown>} expected
 * @returns {ExpectResult[]}
 */
function evaluateFixture(messageId, result, expected) {
  /** @type {ExpectResult[]} */
  const checks = [];

  if (expected.classification) {
    checks.push({
      label: "classification",
      pass: result.parsed.classification === expected.classification,
      detail: `${result.parsed.classification} (expected ${expected.classification})`,
    });
  }
  if (expected.vendorId) {
    checks.push({
      label: "vendorId",
      pass: result.match.vendorId === expected.vendorId,
      detail: `${result.match.vendorId ?? "null"}`,
    });
  }
  if (expected.poNumber) {
    const po = result.parsed.poNumbers[0] ?? null;
    checks.push({
      label: "poNumber",
      pass: po === expected.poNumber,
      detail: `${po}`,
    });
  }
  if (expected.minConfidence !== undefined) {
    checks.push({
      label: "minConfidence",
      pass: result.match.confidenceScore >= expected.minConfidence,
      detail: `${result.match.confidenceScore}`,
    });
  }
  if (expected.maxConfidence !== undefined) {
    checks.push({
      label: "maxConfidence",
      pass: result.match.confidenceScore <= expected.maxConfidence,
      detail: `${result.match.confidenceScore}`,
    });
  }
  if (expected.humanReviewRequired !== undefined) {
    checks.push({
      label: "humanReviewRequired",
      pass: result.match.humanReviewRequired === expected.humanReviewRequired,
      detail: `${result.match.humanReviewRequired}`,
    });
  }
  if (expected.vendorOrderCompleteClaim !== undefined) {
    checks.push({
      label: "vendorOrderCompleteClaim",
      pass: result.parsed.vendorOrderCompleteClaim === expected.vendorOrderCompleteClaim,
      detail: `${result.parsed.vendorOrderCompleteClaim}`,
    });
  }
  if (expected.purchaseOrderId) {
    checks.push({
      label: "purchaseOrderId",
      pass: result.match.purchaseOrderId === expected.purchaseOrderId,
      detail: `${result.match.purchaseOrderId ?? "null"}`,
    });
  }
  if (expected.reviewStatus) {
    checks.push({
      label: "reviewStatus",
      pass: result.reviewStatus === expected.reviewStatus,
      detail: `${result.reviewStatus}`,
    });
  }
  if (expected.notAutoProcessed) {
    checks.push({
      label: "notAutoProcessed",
      pass: result.reviewStatus !== "auto_processed",
      detail: `${result.reviewStatus}`,
    });
  }

  return checks;
}

/** Approved sample expectations — one row per scorable fixture. */
const FIXTURE_EXPECTATIONS = {
  "msg-po-ack-001": {
    classification: "order_acknowledged",
    vendorId: "vendor-johnstone",
    poNumber: "PO-45821",
    notAutoProcessed: true,
  },
  "msg-backorder-002": {
    classification: "backordered",
    vendorId: "vendor-first",
    poNumber: "PO-45836",
  },
  "msg-partial-ship-003": {
    classification: "partially_shipped",
    vendorId: "vendor-johnstone",
    poNumber: "PO-45821",
  },
  "msg-vendor-complete-004": {
    classification: "vendor_order_complete",
    vendorOrderCompleteClaim: true,
    purchaseOrderId: "po-johnstone-45821",
    reviewStatus: "auto_processed",
  },
  "msg-ambiguous-po-005": {
    maxConfidence: 84,
    humanReviewRequired: true,
  },
  "msg-wrong-job-006": {
    classification: "needs_dispatcher_review",
    poNumber: "PO-45821",
    notAutoProcessed: true,
  },
  "msg-injection-007": {
    notAutoProcessed: true,
    maxConfidence: 10,
  },
  "msg-ferguson-ship-008": {
    classification: "shipped",
    vendorId: "vendor-ferguson",
    poNumber: "PO-46001",
    minConfidence: 85,
  },
  "msg-ferguson-backorder-009": {
    classification: "backordered",
    vendorId: "vendor-ferguson",
    poNumber: "PO-46001",
  },
  "msg-multi-po-010": {
    classification: "partially_shipped",
    vendorId: "vendor-johnstone",
    notAutoProcessed: true,
  },
  "msg-unknown-vendor-011": {
    maxConfidence: 40,
    humanReviewRequired: true,
  },
};

const failures = [];
const fixtureResults = [];
const existing = {
  byMessageId: new Map(),
  byFingerprint: new Map(),
};

for (const fixture of EMAIL_FIXTURES) {
  const result = processInboundEmail(fixture, MULTI_VENDOR_MATCH_CONTEXT, existing);
  if (result.duplicate) {
    console.log(`SKIP duplicate: ${fixture.sourceMessageId}`);
    continue;
  }
  existing.byMessageId.set(fixture.sourceMessageId, fixture.sourceMessageId);

  console.log(
    JSON.stringify({
      messageId: fixture.sourceMessageId,
      classification: result.parsed.classification,
      confidence: result.match.confidenceScore,
      review: result.reviewStatus,
      po: result.parsed.poNumbers[0] ?? null,
      vendorId: result.match.vendorId ?? null,
    }),
  );

  const expected = FIXTURE_EXPECTATIONS[fixture.sourceMessageId];
  if (expected) {
    const checks = evaluateFixture(fixture.sourceMessageId, result, expected);
    const passed = checks.every((c) => c.pass);
    fixtureResults.push({
      messageId: fixture.sourceMessageId,
      passed,
      checks,
    });
    if (!passed) {
      for (const c of checks.filter((x) => !x.pass)) {
        failures.push(`${fixture.sourceMessageId}: ${c.label} — ${c.detail}`);
      }
    }
  }
}

const dup = processInboundEmail(EMAIL_FIXTURES[3], MULTI_VENDOR_MATCH_CONTEXT, {
  byMessageId: new Map([[EMAIL_FIXTURES[3].sourceMessageId, "existing"]]),
  byFingerprint: new Map(),
});
if (!dup.duplicate) failures.push("duplicate message id not detected");

const scored = fixtureResults.length;
const passedCount = fixtureResults.filter((r) => r.passed).length;
const accuracyPct = scored > 0 ? Math.round((passedCount / scored) * 1000) / 10 : 0;

console.log("\n--- Phase 5 fixture accuracy report ---");
console.log(
  "Scoring: each approved fixture passes when all defined expectations match (classification, vendor/PO match, confidence band, review routing).",
);
console.log(`Gate: ≥${ACCURACY_GATE}% on approved sample set (${scored} fixtures).`);
for (const row of fixtureResults) {
  const status = row.passed ? "PASS" : "FAIL";
  const failedChecks = row.checks.filter((c) => !c.pass).map((c) => c.label);
  console.log(
    `  ${status} ${row.messageId}${failedChecks.length ? ` (${failedChecks.join(", ")})` : ""}`,
  );
}
console.log(`Aggregate: ${passedCount}/${scored} = ${accuracyPct}%`);
console.log(`Gate ${accuracyPct >= ACCURACY_GATE ? "PASS" : "FAIL"} (threshold ${ACCURACY_GATE}%)`);

if (accuracyPct < ACCURACY_GATE) {
  failures.push(`accuracy gate: ${accuracyPct}% < ${ACCURACY_GATE}%`);
}

if (failures.length) {
  console.error("\nFAIL email tests:", failures);
  process.exit(1);
}

console.log("\nPASS email parser/matcher fixture tests");
