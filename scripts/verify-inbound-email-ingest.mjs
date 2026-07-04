/**
 * Offline verification for inbound Gmail invoice ingestion foundation.
 * No live Gmail required — uses fixture message shapes + invoice text.
 *
 * Usage: npm run verify:inbound-email-ingest
 */
import { findPdfAttachments, parseGmailHeaders, parseGmailPushNotification } from "../functions/src/gmailInbound.ts";
import { parseInboundInvoiceText } from "../functions/src/invoice/processInvoiceForInbound.ts";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";

const FIXTURE_MESSAGE = {
  id: "msg-fixture-6164159",
  threadId: "thread-fixture-1",
  internalDate: String(Date.parse("2026-06-24T10:00:00Z")),
  payload: {
    headers: [
      { name: "From", value: "billing@johnstonesupply.com" },
      { name: "Subject", value: "Invoice 6164159 — Planet Fitness Pickup" },
      { name: "Date", value: "Tue, 24 Jun 2026 10:00:00 -0500" },
    ],
    parts: [
      {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: "Please see attached invoice." },
          },
          {
            mimeType: "application/pdf",
            filename: "invoice-6164159.pdf",
            body: { attachmentId: "att-fixture-1", size: 12345 },
          },
        ],
      },
    ],
  },
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

console.log("verify-inbound-email-ingest\n");

console.log("1. Gmail header parsing");
const headers = parseGmailHeaders(FIXTURE_MESSAGE.payload.headers);
assert("senderEmail parsed", headers.senderEmail === "billing@johnstonesupply.com");
assert("subject parsed", headers.subject.includes("6164159"));
assert("receivedAt ISO", !Number.isNaN(Date.parse(headers.receivedAt)));

console.log("\n2. PDF attachment discovery");
const pdfs = findPdfAttachments(FIXTURE_MESSAGE.payload);
assert("finds one PDF", pdfs.length === 1);
assert("PDF filename", pdfs[0]?.filename === "invoice-6164159.pdf");
assert("attachment id", pdfs[0]?.attachmentId === "att-fixture-1");

console.log("\n3. Johnstone parser wiring (review-only path)");
const fixturePage = INVOICE_FIXTURES[0];
const batch = parseInboundInvoiceText(fixturePage.extractedText, {
  importBatchId: "batch-verify-6164159",
  gmailMessageId: FIXTURE_MESSAGE.id,
});
assert("batch has results", batch.results.length >= 1);
const first = batch.results[0];
assert("invoice number parsed", first?.processing?.parsed.header.vendorInvoiceNumber === "6164159");
assert("review-only status", first?.processing?.reviewStatus === "pending_review");
assert("human review required", first?.processing?.humanReviewRequired === true);
assert("outcome needs_review", first?.outcome === "needs_review");
assert("no auto-processed in summary", batch.summary.processed === 0);
assert("needsReview > 0", batch.summary.needsReview >= 1);

console.log("\n4. Multi-PDF message shape");
const multiPdfMessage = {
  payload: {
    parts: [
      { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "a1", size: 100 } },
      { mimeType: "application/pdf", filename: "b.PDF", body: { attachmentId: "b1", size: 200 } },
    ],
  },
};
const multi = findPdfAttachments(multiPdfMessage.payload);
assert("finds two PDFs", multi.length === 2);

console.log("\n5. Gmail Pub/Sub push notification decode");
const pushPayload = Buffer.from(
  JSON.stringify({ emailAddress: "svbotmail@gmail.com", historyId: "1234567890" }),
  "utf8",
).toString("base64");
const push = parseGmailPushNotification(pushPayload);
assert("push emailAddress", push?.emailAddress === "svbotmail@gmail.com");
assert("push historyId", push?.historyId === "1234567890");
assert("invalid push rejected", parseGmailPushNotification("not-json") === null);

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("verify-inbound-email-ingest: PASS");
