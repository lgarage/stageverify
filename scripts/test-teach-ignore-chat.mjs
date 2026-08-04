/**
 * Offline unit checks for teach-chat intent + consent helpers.
 * Run: npx tsx scripts/test-teach-ignore-chat.mjs
 */
import assert from "node:assert/strict";
import {
  interpretTeachNote,
  isArmableVendorKeyForTeach,
  isTeachConsentNo,
  isTeachConsentYes,
  noteTeachesIgnoreFromNowOn,
} from "../src/dispatcher/invoice/teachIgnoreChat.ts";

assert.equal(isTeachConsentYes("yes"), true);
assert.equal(isTeachConsentYes("YES."), true);
assert.equal(isTeachConsentYes("ignore credits"), false);
assert.equal(isTeachConsentNo("no"), true);
assert.equal(noteTeachesIgnoreFromNowOn("ignore these from now on"), true);
assert.equal(noteTeachesIgnoreFromNowOn("When Ship Via is WILL CALL"), false);

const importRow = {
  id: "vii-test",
  inboundEmailProcessingId: "inbound-1",
  gmailMessageId: "g1",
  importBatchId: "b1",
  pageId: "page-1",
  reviewStatus: "pending_review",
  importStatus: "issue",
  confidenceScore: 0.2,
  humanReviewRequired: true,
  parsedHeader: {},
  parsedLines: [],
  parseWarnings: ["Missing vendorInvoiceNumber"],
  orderNotes: [],
  parserFormatId: "generic",
  detectedVendorName: "Monroe Equipment",
};

const ignore = interpretTeachNote(
  "Ignore these from now on",
  "Monroe Equipment",
  importRow,
);
assert.equal(ignore.kind, "ignore_document_type");
assert.match(ignore.echo, /Reply yes to confirm/i);
assert.ok(ignore.fingerprint.documentType);

const invoiceRow = {
  ...importRow,
  parsedHeader: { vendorInvoiceNumber: "INV-999" },
  parseWarnings: [],
};
const invoiceIgnore = interpretTeachNote(
  "Ignore these from now on",
  "Monroe Equipment",
  invoiceRow,
);
assert.equal(invoiceIgnore.kind, "ignore_document_type");
assert.match(invoiceIgnore.echo, /skip future INVOICES/i);
assert.match(invoiceIgnore.echo, /WARNING/i);

const unknownVendorRow = {
  ...importRow,
  detectedVendorName: "",
  parserFormatId: "generic",
};
assert.equal(isArmableVendorKeyForTeach("unknown-vendor"), false);
const unknownBlock = interpretTeachNote(
  "Ignore these from now on",
  "",
  unknownVendorRow,
);
assert.equal(unknownBlock.kind, "ambiguous");
assert.match(unknownBlock.echo, /known vendor/i);

const lesson = interpretTeachNote(
  "When Ship Via is WILL CALL, set fulfillment to will_call_pickup",
  "Johnstone",
  importRow,
);
assert.equal(lesson.kind, "playbook_lesson");

console.log("test-teach-ignore-chat: PASS");
