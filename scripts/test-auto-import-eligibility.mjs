/**
 * Stage 1 auto-import eligibility — deterministic rules (offline).
 * Run: npm run test:auto-import-eligibility
 */
import { computeAutoImportEligibility } from "../src/dispatcher/invoice/computeAutoImportEligibility.ts";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import {
  expectedInvoiceLines,
  processInvoicePage,
} from "../src/dispatcher/invoice/processInvoicePage.ts";

let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  failed++;
  console.error(`  ✗ ${msg}`);
  if (detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
}

function eligibilityFromProcessResult(result, pageId) {
  const lines = expectedInvoiceLines(result);
  return computeAutoImportEligibility({
    importStatus: result.importStatus,
    confidenceScore: result.confidenceScore,
    humanReviewRequired: result.humanReviewRequired,
    duplicate: result.duplicate,
    parseWarnings: result.parsed.parseWarnings,
    parsedHeader: result.parsed.header,
    parsedLines: lines,
    parsedLineCount: lines.length,
    pageId,
  });
}

console.log("\n=== Auto-import eligibility fixtures ===\n");

const existing = { byPageId: new Map(), byFingerprint: new Map() };

for (const fixture of INVOICE_FIXTURES) {
  const result = processInvoicePage(fixture, existing);
  if (result.duplicate) continue;
  existing.byPageId.set(fixture.pageId, fixture.pageId);

  const elig = eligibilityFromProcessResult(result, fixture.pageId);

  if (fixture.pageId === "inv-p411190-4046362") {
    if (elig.importDecisionMode === "review_required" && !elig.autoImportEligible) {
      pass("P411190 → review_required (confidence 75, unknown fulfillment)");
    } else {
      fail("P411190 expected review_required until confidence ≥85", elig);
    }
  }

  if (fixture.pageId.startsWith("inv-so-4046362")) {
    if (elig.importDecisionMode === "blocked" && !elig.autoImportEligible) {
      pass(`${fixture.pageId} S/O without invoice # → blocked`);
    } else {
      fail(`${fixture.pageId} expected blocked`, elig);
    }
  }

  if (fixture.pageId === "inv-6164159") {
    if (elig.importDecisionMode === "suggested_import") {
      pass("inv-6164159 will-call pickup → suggested_import");
    } else {
      fail("inv-6164159 expected suggested_import", elig);
    }
  }
}

const dupResult = processInvoicePage(INVOICE_FIXTURES[6], {
  byPageId: new Map(),
  byFingerprint: new Map([[INVOICE_FIXTURES[0].pageId, INVOICE_FIXTURES[0].pageId]]),
});
const dupElig = computeAutoImportEligibility({
  importStatus: dupResult.importStatus,
  confidenceScore: dupResult.confidenceScore,
  humanReviewRequired: dupResult.humanReviewRequired,
  duplicate: true,
  parseWarnings: dupResult.parsed.parseWarnings,
  parsedHeader: dupResult.parsed.header,
  parsedLines: expectedInvoiceLines(dupResult),
  parsedLineCount: 1,
  pageId: dupResult.page.pageId,
});
if (dupElig.importDecisionMode === "blocked") {
  pass("duplicate flag → blocked");
} else {
  fail("duplicate expected blocked", dupElig);
}

const zeroLineElig = computeAutoImportEligibility({
  importStatus: "pending",
  confidenceScore: 90,
  humanReviewRequired: false,
  duplicate: false,
  parseWarnings: [],
  parsedHeader: {
    customerAccountNumber: "001",
    vendorOrderNumber: "123",
    vendorInvoiceNumber: "INV1",
    customerPoOrReference: "PO",
    orderDate: "2026-01-01",
    vendorBranchName: "Johnstone Supply",
    buyerName: "Buyer",
  },
  parsedLines: [],
  parsedLineCount: 0,
  pageId: "inv-zero",
});
if (zeroLineElig.importDecisionMode === "blocked") {
  pass("zero lines → blocked");
} else {
  fail("zero lines expected blocked", zeroLineElig);
}

const partialElig = computeAutoImportEligibility({
  importStatus: "partial",
  confidenceScore: 95,
  humanReviewRequired: true,
  duplicate: false,
  parseWarnings: [],
  parsedHeader: {
    customerAccountNumber: "001",
    vendorOrderNumber: "123",
    vendorInvoiceNumber: "INV1",
    customerPoOrReference: "PO",
    orderDate: "2026-01-01",
    vendorBranchName: "Johnstone Supply",
    buyerName: "Buyer",
  },
  parsedLines: [
    {
      lineType: "product",
      excludeFromExpectedItems: false,
      quantityOrdered: 2,
      quantityShipped: 1,
      quantityBackordered: 1,
    },
  ],
  parsedLineCount: 1,
  pageId: "inv-partial",
});
if (partialElig.importDecisionMode === "review_required") {
  pass("partial import → review_required");
} else {
  fail("partial expected review_required", partialElig);
}

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-auto-import-eligibility: PASS");
