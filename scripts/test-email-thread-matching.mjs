/**
 * Offline tests for inbound reply matching ladder (Stage 1).
 * Usage: npm run test:email-thread-matching
 */
import { resolveReplyToThread } from "../functions/src/email/resolveReplyToThread.ts";
import {
  assembleOutboundEmailBody,
  buildPlusReplyTo,
  extractCanonicalFooterTokenFromBody,
  extractNonCanonicalBodyRefTokens,
  extractTokenFromBody,
  extractTokenFromSubject,
  formatBodyTrackingFooter,
  formatSubjectTag,
  generateTrackingToken,
  subjectWithTrackingTag,
} from "../functions/src/email/trackingToken.ts";

const TOKEN = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const OTHER_TOKEN = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
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
assert(
  "body footer Ref format",
  formatBodyTrackingFooter(TOKEN).includes(`Ref: SV-${TOKEN}`),
);
assert(
  "extractTokenFromBody canonical footer only",
  extractTokenFromBody(`Thanks\n\n---\nRef: SV-${TOKEN}`) === TOKEN.toLowerCase(),
);
assert(
  "quoted Ref outside footer ignored for extraction",
  extractTokenFromBody(`Ref: SV-${OTHER_TOKEN}\n\nShipped today.`) === null,
);
assert(
  "non-canonical refs detected",
  extractNonCanonicalBodyRefTokens(`Ref: SV-${OTHER_TOKEN}\n\nThanks\n\n---\nRef: SV-${TOKEN}`).includes(
    OTHER_TOKEN.toLowerCase(),
  ),
);
assert(
  "canonical footer token extracted",
  extractCanonicalFooterTokenFromBody(assembleOutboundEmailBody("Hi", TOKEN)) === TOKEN.toLowerCase(),
);

console.log("\n1b. Outbound clean subject (no visible [SV-*] tag)");
const userSubject = "hey";
const userBody = "Please confirm ETA";
const outboundSubject = userSubject;
const outboundBody = assembleOutboundEmailBody(userBody, TOKEN);
assert("outbound subject has no [SV-] tag", !/\[SV-/i.test(outboundSubject));
assert("outbound subject unchanged", outboundSubject === userSubject);
assert("outbound body includes Ref footer", outboundBody.includes(`Ref: SV-${TOKEN}`));
assert(
  "default signature before Ref when absent",
  outboundBody.includes("Thanks,\nL. Garage Dispatch") &&
    outboundBody.indexOf("Thanks,\nL. Garage Dispatch") <
      outboundBody.indexOf(`Ref: SV-${TOKEN}`),
);
const issueStyleBody = "Please confirm ETA.\n\nThank you,";
const issueOutboundBody = assembleOutboundEmailBody(issueStyleBody, TOKEN);
assert(
  "Resolve Issue sign-off kept; Ref after sign-off",
  issueOutboundBody.endsWith(formatBodyTrackingFooter(TOKEN).trim()) &&
    issueOutboundBody.includes("Thank you,") &&
    !issueOutboundBody.includes("Thanks,\nL. Garage Dispatch"),
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

console.log("\n6. body footer token match");
const bodyWithRef = assembleOutboundEmailBody("Shipped today.", TOKEN);
const bodyMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-4b",
    senderEmail: "unknown@evil.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: hey",
    bodyText: bodyWithRef,
    receivedAt: "2026-07-06T12:16:00Z",
  },
  headers: {},
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: false,
});
assert("matchedBy bodyToken", bodyMatch.matchedBy === "bodyToken");
assert("body token unknown sender flagged", bodyMatch.humanReviewRequired === true);

console.log("\n7. unmatched → none");
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

console.log("\n8. multi-PO forces review");
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

console.log("\n9. spoofed Ref does not override threadId match");
const spoofRefBody = `Ref: SV-${OTHER_TOKEN}\n\nOn Tue wrote:\n> original\n\nShipped today.`;
const spoofOverride = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-7",
    threadId: "thread-abc",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: status",
    bodyText: spoofRefBody,
    receivedAt: "2026-07-06T12:30:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
  senderAuthPass: true,
});
assert("still matchedBy threadId", spoofOverride.matchedBy === "threadId");
assert("links original delivery", spoofOverride.outboundEvent?.deliveryOrderId === "del-1");
assert("non-canonical ref flagged", spoofOverride.applyConflictReason?.includes("non_canonical_body_ref"));
assert("humanReviewRequired on conflict", spoofOverride.humanReviewRequired === true);

console.log("\n10. conflicting canonical footer Ref → Needs Review");
const conflictBody = assembleOutboundEmailBody("Update", OTHER_TOKEN);
const conflictMatch = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-8",
    threadId: "thread-abc",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: status",
    bodyText: conflictBody,
    receivedAt: "2026-07-06T12:35:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
  senderAuthPass: true,
});
assert("threadId wins over footer", conflictMatch.matchedBy === "threadId");
assert("body_ref_conflict reason", conflictMatch.applyConflictReason?.includes("body_ref_conflict"));
assert("conflict needs review", conflictMatch.humanReviewRequired === true);

console.log("\n11. footer Ref matched only when no stronger signal");
const footerOnlyBody = assembleOutboundEmailBody("Shipped today.", TOKEN);
const footerOnly = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-9",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: hey",
    bodyText: footerOnlyBody,
    receivedAt: "2026-07-06T12:40:00Z",
  },
  headers: {},
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
  senderAuthPass: true,
});
assert("matchedBy bodyToken weak fallback", footerOnly.matchedBy === "bodyToken");
assert("footer always needs review", footerOnly.humanReviewRequired === true);

console.log("\n12. known vendor + forged Ref + failed SPF stays flagged");
const forgedSpoof = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-10",
    threadId: "thread-abc",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: status",
    bodyText: `Ref: SV-${OTHER_TOKEN}\n\nShipped.`,
    receivedAt: "2026-07-06T12:45:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
  senderAuthPass: false,
});
assert("thread match preserved", forgedSpoof.matchedBy === "threadId");
assert("spoof auth flag", forgedSpoof.applyConflictReason?.includes("spoofed_body_ref_failed_auth"));
assert("humanReviewRequired", forgedSpoof.humanReviewRequired === true);

console.log("\n13. trusted thread match clears review when no conflicts");
const trusted = resolveReplyToThread({
  message: {
    sourceMessageId: "msg-in-11",
    threadId: "thread-abc",
    senderEmail: "rep@johnstone.com",
    recipientEmails: ["svbotmail@gmail.com"],
    subject: "Re: status",
    bodyText: "Shipped today.",
    receivedAt: "2026-07-06T12:50:00Z",
  },
  headers: { threadId: "thread-abc" },
  outboundEvents: OUTBOUND,
  matchContext: BASE_CTX,
  senderDomainKnown: true,
  senderAuthPass: true,
});
assert("trusted threadId match", trusted.matchedBy === "threadId");
assert("no review when clean", trusted.humanReviewRequired === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
