/**
 * Unit tests for PDF text normalization (U+XX00 Johnstone custom-font encoding).
 * Usage: npx tsx scripts/test-pdf-text-normalize.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import {
  adaptJohnstoneMultiColumnLayout,
  hasCustomFontPdfEncoding,
  normalizeCustomFontPdfText,
  postProcessExtractedPdfText,
} from "../functions/src/inboundEmail/normalizePdfText.ts";
import { processInvoicePage } from "../src/dispatcher/invoice/processInvoicePage.ts";

const require = createRequire(import.meta.url);
const pdfParse = require("../functions/node_modules/pdf-parse");

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

console.log("test-pdf-text-normalize\n");

console.log("1. U+XX00 sample normalizes to usable ASCII");
const xx00Sample = "䌀甀猀琀漀洀攀爀\u3000㐀\u3000㐀㘀㌀㘀\u3100";
const normalized = normalizeCustomFontPdfText(xx00Sample);
assert("Customer token", /Customer/i.test(normalized));
assert("has digit 4", /4/.test(normalized));
assert("ASCII ratio high", normalized.replace(/[^\x20-\x7E]/g, "").length / normalized.length > 0.8);

console.log("\n2. Clean ASCII fixture text not damaged");
const cleanFixture = INVOICE_FIXTURES.find((f) => f.pageId === "inv-so-4046362")?.extractedText ?? "";
const afterClean = postProcessExtractedPdfText(cleanFixture);
assert("unchanged customer row", afterClean.includes("0018114 4046362 blackduck hartford"));
assert("unchanged line header", /LN QNTY ORD/i.test(afterClean));
const cleanPage = {
  pageId: "inv-so-4046362",
  importBatchId: "batch-test",
  pageIndexInBatch: 0,
  extractedText: afterClean,
};
const cleanResult = processInvoicePage(cleanPage, { byPageId: new Map(), byFingerprint: new Map() });
assert("fixture still parses SO", cleanResult.parsed.header.vendorOrderNumber === "4046362");
assert("fixture still has lines", cleanResult.parsed.lines.length >= 1);
assert("fixture issue (no invoice #)", cleanResult.importStatus === "issue");

console.log("\n3. Reference PDF via pdf-parse + normalize (best-effort cached path)");
const pdfPath = process.argv[2] ?? "c:/Users/daday/Downloads/JS_Invoice_P411190_54632502.PDF";
let rawPdfText = "";
try {
  const parsed = await pdfParse(readFileSync(pdfPath));
  rawPdfText = parsed.text ?? "";
} catch (err) {
  console.log("  (skip reference PDF — not found locally)");
}
if (rawPdfText) {
  assert("raw has custom font encoding", hasCustomFontPdfEncoding(rawPdfText));
  const repaired = postProcessExtractedPdfText(rawPdfText);
  assert("repaired has Customer #", /Customer\s*#/i.test(repaired));
  assert("repaired ASCII ratio", repaired.replace(/[^\x20-\x7E\n]/g, "").length / repaired.length > 0.85);
}

console.log("\n4. Layout adapter on pdf.js-style line text");
const pdfJsStyle = `
Customer #   Order Date   Sales Order #   Buyer   Customer P/O #   Ship Via   Salesman
0008745   01/07/2026 4046362   DAN DAY   blackduck hartford   TRUCK
LN   QNTY   QNT   QNT   PRODUCT   UOM   LIST   NET   EXTENSION
1   4   4   L97-525   FILTER   EA   18.99   8.74   $34.96
`.trim();
const adapted = adaptJohnstoneMultiColumnLayout(pdfJsStyle);
assert("injects stacked Sales Order #", /Sales Order #\s*\n\s*4046362/i.test(adapted));
const adaptedPage = {
  pageId: "page-0",
  importBatchId: "batch-adapt",
  pageIndexInBatch: 0,
  extractedText: adapted,
};
const adaptedResult = processInvoicePage(adaptedPage, { byPageId: new Map(), byFingerprint: new Map() });
assert("adapted parses vendorOrderNumber", adaptedResult.parsed.header.vendorOrderNumber === "4046362");
assert("adapted parses customerAccountNumber", adaptedResult.parsed.header.customerAccountNumber === "0008745");
assert("adapted parses PO", /blackduck/i.test(adaptedResult.parsed.header.customerPoOrReference));
assert("adapted issue (missing Invoice #)", adaptedResult.importStatus === "issue");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
