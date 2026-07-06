/**
 * Offline tests for inbound reply matching ladder (Stage 1).
 * Usage: npm run test:email-thread-matching
 */
import { resolveReplyToThread } from "../functions/src/email/resolveReplyToThread.ts";
import {
  buildPlusReplyTo,
  extractTokenFromSubject,
  formatSubjectTag,
  generateTrackingToken,
  subjectWithTrackingTag,
} from "../functions/src/email/trackingToken.ts";

const TOKEN = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const OUTBOUND = [
  {
    eventId: "vee-out-1",
    threadId: "thread-abc",
    rfc822MessageId: "<out-msg-001@svbotmail>",
    trackingToken: TOKEN,
    deliveryOrderId: "del-1",
    vendorId: "vendor-1",
    jobId: "job-1",
    purchaseOrderId: "po-1",
  },
];

const BASE_CTX = {
  vendors: [{ id: "vendor-1", email: "rep@johnstone.com" }],
  jobs: [{ id: "job-1", jobNumber: "26-1001" }],
  purchaseOrders: [{ id: "po-1", poNumber: "411190", jobId: "job-1", vendorId: "vendor-1" }],
  deliveries: [
    {
      id: "del-1",
      orderNumber: "ORD-1001",
      jobId: "job-1",
      vendorId: "vendor-1",
      purchaseOrderId: "po-1",
    },
  ],
};

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log("\n=== test-email-thread-matching ===\n");

console.log("1. Tracking token helpers");
assert("generateTrackingToken is UUID-shaped", /^[0-9a-f-]{36}$/i.test(generateTrackingToken()));
assert("subject tag format", formatSubjectTag(TOKEN).includes(TOKEN));
assert(
  "subjectWithTrackingTag prepends",
  subjectWithTrackingTag("PO update", TOKEN).startsWith(formatSubjectTag(TOKEN)),
);
assert(
  "extractTokenFromSubject",
  extractTokenFromSubject(subjectWithTrackingTag("Re: status", TOKEN)) === TOKEN.toLowerCase(),
);
assert(
  "plus Reply-To format",
  buildPlusReplyTo("svbotmail@gmail.com", TOKEN).includes("+t-"),
);

console.log("\n2. threadId match");
const threadMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-1",
    threadId: "thread-abc",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: status update",
    bodyText: "Shipped today.",
    receivedAt: "2026-07-06T12:00:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
});
assert("matchedBy threadId", threadMatch.matchedBy === "threadId");
assert("links delivery", threadMatch.outboundEvent?.deliveryOrderId === "del-1");

console.log("\n3. In-Reply-To / References match");
const refMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-2",
    threadId: "thread-new",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "materials update",
    bodyText: "On the way.",
    receivedAt: "2026-07-06T12:05:00Z",
  },
  headers: {
    threadId: "thread-new",
    inReplyTo: "<out-msg-001@svbotmail>",
    references: ["<other@x.com>", "<out-msg-001@svbotmail>"],
  },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
});
assert("matchedBy references", refMatch.matchedBy === "references");

console.log("\n4. subject token match");
const subMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-3",
    senderEmail: "unknown@evil.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: subjectWithTrackingTag("Hello", TOKEN),
    bodyText: "Spoof attempt",
    receivedAt: "2026-07-06T12:10:00Z",
  },
  headers: {},
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: false,
});
assert("matchedBy subjectToken", subMatch.matchedBy === "subjectToken");
assert("token-only unknown sender flagged", subMatch.humanReviewRequired === true);
assert(
  "token_match_unknown_sender reason",
  subMatch.applyConflictReason === "token_match_unknown_sender",
);

console.log("\n5. plus-address token match");
const plusAddr = buildPlusReplyTo("svbotmail@gmail.com", TOKEN);
const plusMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-4",
    senderEmail: "rep@johnstone.com",
    recipientEmails: [plusAddr],
    subject: "Re: PO",
    bodyText: "Confirmed.",
    receivedAt: "2026-07-06T12:15:00Z",
  },
  headers: { toAddresses: [plusAddr] },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
});
assert("matchedBy plusToken", plusMatch.matchedBy === "plusToken");

console.log("\n6. unmatched → none");
const noneMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-5",
    senderEmail: "spam@unknown.net",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Newsletter",
    bodyText: "Buy now",
    receivedAt: "2026-07-06T12:20:00Z",
  },
  headers: {},
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: false,
});
assert("matchedBy none", noneMatch.matchedBy === "none");
assert("humanReviewRequired", noneMatch.humanReviewRequired === true);

console.log("\n7. multi-PO forces review");
const multiPo = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-6",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "PO 411190 and PO 411205 update",
    bodyText: "PO 411190 shipped; PO 411205 backordered.",
    receivedAt: "2026-07-06T12:25:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
});
assert("multi-PO humanReviewRequired", multiPo.humanReviewRequired === true);
assert(
  "multiple_po_references reason",
  multiPo.applyConflictReason?.includes("multiple_po_references"),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
