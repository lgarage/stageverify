/**
 * End-to-end: extractTextFromPdfBuffer (pdf.js) + parser on Johnstone reference PDF.
 * Usage: npx tsx scripts/test-pdf-extract-4046362.mjs [pdf-path]
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { extractTextFromPdfBuffer } from "../functions/lib/inboundEmail/extractPdfText.js";
import { hasCustomFontPdfEncoding } from "../functions/lib/inboundEmail/normalizePdfText.js";
import { shouldReprocessExistingDoc } from "../functions/lib/inboundEmail/processInboundGmailMessage.js";
import { processInvoicePage } from "../src/dispatcher/invoice/processInvoicePage.ts";

const require = createRequire(import.meta.url);
const pdfParse = require("../functions/node_modules/pdf-parse");

const pdfPath = process.argv[2] ?? "c:/Users/daday/Downloads/JS_Invoice_P411190_54632502.PDF";

let passed = 0;
let failed = 0;
function assert(label, ok) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log("test-pdf-extract-4046362\n");

const buffer = readFileSync(pdfPath);
const extracted = await extractTextFromPdfBuffer(buffer);

assert("extractor is pdfjs", extracted.extractor === "pdfjs");
assert("text has 4046362", /4046362/.test(extracted.text));
assert("text has Customer #", /Customer\s*#/i.test(extracted.text));
assert("no custom font encoding in output", !hasCustomFontPdfEncoding(extracted.text));

const page = {
  pageId: "page-0",
  importBatchId: "batch-e2e",
  pageIndexInBatch: 0,
  extractedText: extracted.text.split("\f")[0] ?? extracted.text,
};
const result = processInvoicePage(page, { byPageId: new Map(), byFingerprint: new Map() });
assert("parses vendorOrderNumber 4046362", result.parsed.header.vendorOrderNumber === "4046362");
assert("parses customer account", result.parsed.header.customerAccountNumber === "0008745");
assert("parses PO blackduck", /blackduck/i.test(result.parsed.header.customerPoOrReference));
assert("has 5 parsed lines", result.parsed.lines.length === 5);
const productCodes = result.parsed.lines.map((l) => l.vendorProductNumber);
assert(
  "product codes match PDF",
  ["L97-525", "L97-532", "L63-264", "P33-332", "P34-544"].every((code) =>
    productCodes.includes(code),
  ),
);
assert(
  "invoice message in orderNotes not lines",
  result.parsed.orderNotes.some((n) => /SHIP COMPLETE/i.test(n)) &&
    !result.parsed.lines.some((l) => /Invoice Message/i.test(l.description)),
);
assert("first line has UOM", result.parsed.lines[0]?.unitOfMeasure === "EA");
assert(
  "first line full description",
  /PLEATED EXTENDED SURFACE/i.test(result.parsed.lines[0]?.description ?? ""),
);
assert("issue import (no invoice #)", result.importStatus === "issue");

const badDoc = {
  id: "inbound-test",
  gmailMessageId: "test",
  senderEmail: "",
  subject: "",
  receivedAt: new Date().toISOString(),
  attachmentFilenames: [],
  pdfAttachments: [],
  combinedExtractedText: (await pdfParse(buffer)).text ?? "",
  processingStatus: "parsed",
  parseResult: { importBatchId: "b", processed: 0, needsReview: 1, failed: 0, total: 1, reviewRecordIds: ["vii-test-page-0"] },
  reviewStatus: "pending_review",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
if (hasCustomFontPdfEncoding(badDoc.combinedExtractedText)) {
  assert("shouldReprocess bad cached encoding", shouldReprocessExistingDoc(badDoc, { retryOnError: true }));
} else {
  console.log("  (skip reprocess probe — raw not custom-font)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
