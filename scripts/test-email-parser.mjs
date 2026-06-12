/**
 * Email parser/matcher fixture tests (offline).
 * Run: npm run test:email-parser
 */

import { processInboundEmail } from "../src/dispatcher/email/processEmailMessage.ts";
import {
  EMAIL_FIXTURES,
  MULTI_VENDOR_MATCH_CONTEXT,
} from "../src/dispatcher/email/emailFixtures.ts";

const failures = [];
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

  if (fixture.sourceMessageId === "msg-po-ack-001") {
    if (result.parsed.classification !== "order_acknowledged") {
      failures.push("ack classification");
    }
    if (result.match.humanReviewRequired) {
      failures.push("ack should not auto-apply vendor complete");
    }
  }

  if (fixture.sourceMessageId === "msg-vendor-complete-004") {
    if (!result.parsed.vendorOrderCompleteClaim) {
      failures.push("vendor complete claim");
    }
    if (result.match.purchaseOrderId !== "po-johnstone-45821") {
      failures.push("vendor complete PO match");
    }
  }

  if (fixture.sourceMessageId === "msg-ambiguous-po-005") {
    if (result.match.confidenceScore >= 85) {
      failures.push("ambiguous email must not be high confidence");
    }
  }

  if (fixture.sourceMessageId === "msg-injection-007") {
    if (result.reviewStatus === "auto_processed") {
      failures.push("injection email must not auto-process");
    }
  }
}

const dup = processInboundEmail(EMAIL_FIXTURES[3], MULTI_VENDOR_MATCH_CONTEXT, {
  byMessageId: new Map([[EMAIL_FIXTURES[3].sourceMessageId, "existing"]]),
  byFingerprint: new Map(),
});
if (!dup.duplicate) failures.push("duplicate message id not detected");

if (failures.length) {
  console.error("FAIL email tests:", failures);
  process.exit(1);
}

console.log("PASS email parser/matcher fixture tests");
