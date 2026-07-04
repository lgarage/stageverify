/**
 * Offline verification for inbound Gmail invoice ingestion foundation.
 * No live Gmail required — uses fixture message shapes + invoice text.
 *
 * Usage: npm run verify:inbound-email-ingest
 */
import { sanitizeParsedLines } from "../functions/src/inboundEmail/sanitizeParsedLines.ts";
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

console.log("\n3b. S/O confirmation without Invoice # queues for review (issue status)");
const SO_CONFIRMATION_TEXT = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: PLANET FITNESS
Order Date: 06/23/2026
Buyer: TEST BUYER
Ship Via: TRUCK DELIVE

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 2 0 L46-668 THERMOSTAT PROGRAMMABLE
`.trim();
const soBatch = parseInboundInvoiceText(SO_CONFIRMATION_TEXT, {
  importBatchId: "batch-verify-so-4046362",
  gmailMessageId: "msg-fixture-so-4046362",
});
const soFirst = soBatch.results[0];
assert("S/O batch has results", soBatch.results.length >= 1);
assert("S/O importStatus issue", soFirst?.processing?.importStatus === "issue");
assert("S/O outcome needs_review", soFirst?.outcome === "needs_review");
assert("S/O missing invoice warning", (soFirst?.processing?.parsed.parseWarnings ?? []).some((w) => w.includes("missing vendorInvoiceNumber")));
assert("S/O needsReview counted", soBatch.summary.needsReview >= 1);
assert("S/O not in failed bucket", soBatch.summary.failed === 0 || soBatch.summary.needsReview >= 1);
const soLines = sanitizeParsedLines(soFirst?.processing?.parsed.lines ?? []);
assert("S/O parsed lines preserved", soLines.length > 0);

console.log("\n3c. S/O tabular header (4046362 / blackduck hartford) extracts review fields");
const SO_TABULAR_TEXT = `
Johnstone Supply - Sioux Falls
SALES ORDER CONFIRMATION
Customer # Sales Order # Customer P/O # Order Date
0018114 4046362 blackduck hartford 06/23/2026
Buyer Ship Via Job Number
CONNOR SMITH TRUCK DELIVE

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 2 2 0 L46-668 THERMOSTAT PROGRAMMABLE
`.trim();
const tabularBatch = parseInboundInvoiceText(SO_TABULAR_TEXT, {
  importBatchId: "batch-verify-so-tabular-4046362",
  gmailMessageId: "msg-fixture-so-tabular-4046362",
});
const tabularFirst = tabularBatch.results[0];
const tabularHeader = tabularFirst?.processing?.parsed.header;
assert("tabular S/O vendorOrderNumber", tabularHeader?.vendorOrderNumber === "4046362");
assert("tabular S/O customerPoOrReference", tabularHeader?.customerPoOrReference === "blackduck hartford");
assert("tabular S/O buyerName", tabularHeader?.buyerName === "CONNOR SMITH");
assert("tabular S/O importStatus issue", tabularFirst?.processing?.importStatus === "issue");
assert("tabular S/O lines preserved", (tabularFirst?.processing?.parsed.lines ?? []).length > 0);

console.log("\n3d. S/O with Invoice Date but no Invoice # stays issue (no false invoice #)");
const SO_INVOICE_DATE_TEXT = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 4046362
Customer P/O #: blackduck hartford
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Buyer: CONNOR SMITH

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 THERMOSTAT
`.trim();
const invoiceDateBatch = parseInboundInvoiceText(SO_INVOICE_DATE_TEXT, {
  importBatchId: "batch-verify-so-invoice-date-4046362",
  gmailMessageId: "msg-fixture-so-invoice-date-4046362",
});
const invoiceDateFirst = invoiceDateBatch.results[0];
const invoiceDateHeader = invoiceDateFirst?.processing?.parsed.header;
assert("invoice-date S/O no vendorInvoiceNumber", !invoiceDateHeader?.vendorInvoiceNumber);
assert("invoice-date S/O importStatus issue", invoiceDateFirst?.processing?.importStatus === "issue");
assert("invoice-date S/O missing invoice warning", (invoiceDateFirst?.processing?.parsed.parseWarnings ?? []).some((w) => w.includes("missing vendorInvoiceNumber")));

console.log("\n3e. Invoice tabular header (P411190 / 4046362) extracts alphanumeric Invoice #");
const INVOICE_P411190_TEXT = INVOICE_FIXTURES.find((f) => f.pageId === "inv-p411190-4046362")?.extractedText ?? "";
const p411190Batch = parseInboundInvoiceText(INVOICE_P411190_TEXT, {
  importBatchId: "batch-verify-p411190-4046362",
  gmailMessageId: "msg-fixture-p411190-4046362",
});
const p411190First = p411190Batch.results[0];
const p411190Header = p411190First?.processing?.parsed.header;
assert("P411190 vendorInvoiceNumber", p411190Header?.vendorInvoiceNumber === "P411190");
assert("P411190 vendorOrderNumber", p411190Header?.vendorOrderNumber === "4046362");
assert("P411190 shipViaRaw", p411190Header?.shipViaRaw === "Fond du Lac");
assert("P411190 importStatus pending", p411190First?.processing?.importStatus === "pending");
assert("P411190 no missing invoice warning", !(p411190First?.processing?.parsed.parseWarnings ?? []).some((w) => w.includes("missing vendorInvoiceNumber")));
assert("P411190 lines preserved", (p411190First?.processing?.parsed.lines ?? []).length === 5);
assert("P411190 codOnly", p411190Header?.codOnly === true);
assert("P411190 paymentTermsRaw", p411190Header?.paymentTermsRaw === "COD ONLY");

console.log("\n4. parsedLines persistence shape (Table B)");
const rawLines = first?.processing?.parsed.lines ?? [];
const parsedLines = sanitizeParsedLines(rawLines);
assert("parsedLines non-empty", parsedLines.length > 0);
assert("parsedLineCount matches lines.length", parsedLines.length === rawLines.length);
const productLine = parsedLines.find((l) => l.lineType === "product");
assert("product line has qty fields", productLine != null && typeof productLine.quantityOrdered === "number");
assert("product line has vendorProductNumber", Boolean(productLine?.vendorProductNumber));
assert("sanitized line has Table B keys", productLine != null && "quantityShipped" in productLine && "description" in productLine);

console.log("\n5. Multi-PDF message shape");
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

console.log("\n6. Gmail Pub/Sub push notification decode");
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
