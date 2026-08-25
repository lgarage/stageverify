/**
 * Unit tests for Review Vendor Email source layout helper.
 *   npx tsx scripts/test-review-vendor-email-source.mjs
 */
import assert from "node:assert/strict";
import {
  sourceEmailReviewFromInbound,
  sourceEmailReviewFromVendorEvent,
} from "../src/dispatcher/email/sourceEmailReview.ts";

function inbound(overrides = {}) {
  return {
    id: "inbound-test",
    gmailMessageId: "gmail-msg-test",
    senderEmail: "vendor@example.com",
    subject: "Invoice attached",
    receivedAt: "2026-07-26T20:37:54.000Z",
    attachmentFilenames: ["invoice.pdf"],
    processingStatus: "parsed",
    reviewStatus: "pending_review",
    createdAt: "2026-07-26T20:37:54.000Z",
    updatedAt: "2026-07-26T20:37:54.000Z",
    ...overrides,
  };
}

function vendorEvent(overrides = {}) {
  return {
    id: "event-test",
    sourceMessageId: "gmail-msg-event",
    senderEmail: "vendor@example.com",
    subject: "Follow up",
    receivedAt: "2026-03-02T10:00:00.000Z",
    reviewStatus: "pending_review",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
    ...overrides,
  };
}

// a) inbound with combinedExtractedTextPreview → bodyText null, metadata present, no extracted text in body
{
  const extracted =
    "CREDIT Page 1/1 Sold To ACME Heating\nLine item description from OCR";
  const review = sourceEmailReviewFromInbound(
    inbound({
      combinedExtractedTextPreview: extracted,
      combinedExtractedTextTruncated: true,
    }),
  );
  assert.equal(review.bodyText, null);
  assert.equal(review.from, "vendor@example.com");
  assert.equal(review.subject, "Invoice attached");
  assert.ok(review.dateLabel.length > 0);
  assert.equal(review.attachments.length, 1);
  assert.equal(review.attachments[0].filename, "invoice.pdf");
  assert.notEqual(review.bodyText, extracted);
}

// b) inbound with no body and no extracted text → honest empty (bodyText null)
{
  const review = sourceEmailReviewFromInbound(
    inbound({
      attachmentFilenames: [],
      pdfAttachments: undefined,
      combinedExtractedTextPreview: undefined,
    }),
  );
  assert.equal(review.bodyText, null);
  assert.equal(review.attachments.length, 0);
}

// c) 6168008-shaped inbound — empty body, attachment filename, no CREDIT/Sold To in body
{
  const creditDump =
    "CREDIT Page 1/1 Sold To USA Heating & Cooling\nAcct No. 0018114";
  const review = sourceEmailReviewFromInbound(
    inbound({
      id: "inbound-19fa0263965d0c96",
      senderEmail: "dan.day@usaheatingcooling.com",
      subject:
        "Fwd: Acct No. 0018114: Your Invoices From Johnstone Supply-Sioux Falls are Attached",
      receivedAt: "2026-07-26T20:37:54.000Z",
      attachmentFilenames: [
        "siouxfalls_0018114_20260725_10274869_4860472266.pdf",
      ],
      combinedExtractedTextPreview: creditDump,
    }),
  );
  assert.equal(review.bodyText, null);
  assert.equal(review.from, "dan.day@usaheatingcooling.com");
  assert.match(review.subject, /Johnstone Supply-Sioux Falls/);
  assert.equal(
    review.attachments[0].filename,
    "siouxfalls_0018114_20260725_10274869_4860472266.pdf",
  );
  const bodyStr = review.bodyText ?? "";
  assert.ok(!bodyStr.includes("CREDIT"));
  assert.ok(!bodyStr.includes("Sold To"));
}

// d) vendor event with bodyText → that body used; extracted fields ignored
{
  const review = sourceEmailReviewFromVendorEvent(
    vendorEvent({
      bodyText: "Please confirm ship date for PO 12345.",
      snippet: "ignored snippet",
      bodyExcerpt: "ignored excerpt",
    }),
  );
  assert.equal(review.bodyText, "Please confirm ship date for PO 12345.");
}

// e) vendor event with no body/snippet/excerpt → bodyText null
{
  const review = sourceEmailReviewFromVendorEvent(
    vendorEvent({
      bodyText: undefined,
      snippet: undefined,
      bodyExcerpt: undefined,
    }),
  );
  assert.equal(review.bodyText, null);
}

// f) multiple attachmentFilenames → all listed
{
  const review = sourceEmailReviewFromInbound(
    inbound({
      attachmentFilenames: ["invoice-a.pdf", "invoice-b.pdf", "cover.pdf"],
    }),
  );
  assert.equal(review.attachments.length, 3);
  assert.deepEqual(
    review.attachments.map((a) => a.filename),
    ["invoice-a.pdf", "invoice-b.pdf", "cover.pdf"],
  );
}

// vendor event to field when recipientEmails present
{
  const review = sourceEmailReviewFromVendorEvent(
    vendorEvent({
      recipientEmails: ["dispatcher@example.com", "buyer@example.com"],
      bodyText: "Hello",
    }),
  );
  assert.equal(review.to, "dispatcher@example.com, buyer@example.com");
}

// pdfAttachments fallback when attachmentFilenames empty
{
  const review = sourceEmailReviewFromInbound(
    inbound({
      attachmentFilenames: [],
      pdfAttachments: [
        { filename: "from-pdf-array.pdf", mimeType: "application/pdf", sizeBytes: 100 },
      ],
    }),
  );
  assert.equal(review.attachments.length, 1);
  assert.equal(review.attachments[0].filename, "from-pdf-array.pdf");
}

console.log("test-review-vendor-email-source: all assertions passed");
