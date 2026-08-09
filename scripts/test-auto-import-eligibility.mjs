/**
 * Stage 1 auto-import eligibility — deterministic rules (offline).
 * Run: npm run test:auto-import-eligibility
 */
import {
  computeAutoImportEligibility,
  resolveAutoImportEligibility,
} from "../src/dispatcher/invoice/computeAutoImportEligibility.ts";
import { reconcileParseWarningsForHeader } from "../src/dispatcher/invoice/reconcileParseWarningsForHeader.ts";
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

// C2 live reconcile — client warning filter + stale persisted eligibility
{
  const filtered = reconcileParseWarningsForHeader(
    ["missing customerPoOrReference", "uncertain:shipVia"],
    { customerPoOrReference: "2205 EARLY" },
  );
  if (
    !filtered.includes("uncertain:shipVia") ||
    filtered.includes("missing customerPoOrReference")
  ) {
    fail("reconcileParseWarningsForHeader should drop only resolved missing PO", filtered);
  } else {
    pass("client reconcileParseWarningsForHeader drops resolved missing PO");
  }

  const staleResolved = resolveAutoImportEligibility({
    importStatus: "pending",
    confidenceScore: 92,
    humanReviewRequired: true,
    duplicate: false,
    parseWarnings: ["uncertain:shipVia"],
    parsedHeader: {
      customerAccountNumber: "001",
      vendorOrderNumber: "123",
      vendorInvoiceNumber: "INV1",
      customerPoOrReference: "2205 EARLY",
      orderDate: "2026-01-01",
      vendorBranchName: "Johnstone Supply",
      buyerName: "Buyer",
    },
    parsedLines: [
      {
        lineType: "product",
        excludeFromExpectedItems: false,
        quantityOrdered: 2,
        quantityShipped: 2,
        quantityBackordered: 0,
      },
    ],
    parsedLineCount: 1,
    pageId: "inv-c2-stale",
    parserFormatId: "johnstone",
    // Persisted pre-correction eligibility (stale)
    autoImportEligible: false,
    importDecisionMode: "review_required",
    suggestedAction: "Review required — inspect fields and match before approve.",
    reviewRequiredReasons: ["Missing Customer P/O", "Parse warnings (2)"],
    autoImportReasons: [],
  });
  if (staleResolved.reviewRequiredReasons.some((r) => /Missing Customer P\/O/i.test(r))) {
    fail(
      "resolveAutoImportEligibility should recompute away stale Missing Customer P/O",
      staleResolved.reviewRequiredReasons,
    );
  } else {
    pass("stale persisted Missing Customer P/O recomputes after C2 header correction");
  }
}

// CLEANUP Phase 1 — stale parser-era confidence/HRR vetoes after verified C2 correction
{
  const cleanJohnstoneHeader = {
    customerAccountNumber: "001",
    vendorOrderNumber: "SO-1",
    vendorInvoiceNumber: "6169414",
    customerPoOrReference: "2205 EARLY",
    orderDate: "2026-01-01",
    vendorBranchName: "Johnstone Supply",
    buyerName: "Buyer",
  };
  const cleanLines = [
    {
      lineType: "product",
      excludeFromExpectedItems: false,
      quantityOrdered: 2,
      quantityShipped: 2,
      quantityBackordered: 0,
    },
  ];
  const poCorrectionLog = [
    {
      field: "customerPoOrReference",
      previousValue: "",
      newValue: "2205 EARLY",
    },
  ];

  // A — verified PO correction + otherwise clean CURRENT → suggested_import; score stays 80
  const afterVerified = computeAutoImportEligibility({
    importStatus: "pending",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parseWarnings: [],
    parsedHeader: cleanJohnstoneHeader,
    parsedLines: cleanLines,
    parsedLineCount: 1,
    pageId: "inv-6169414",
    parserFormatId: "johnstone",
    fieldCorrectionLog: poCorrectionLog,
  });
  if (
    afterVerified.importDecisionMode === "suggested_import" &&
    afterVerified.autoImportEligible &&
    afterVerified.autoImportConfidence === 80 &&
    !afterVerified.reviewRequiredReasons.some((r) =>
      /Parser confidence|human review required/i.test(r),
    )
  ) {
    pass(
      "A: verified C2 PO correction + clean CURRENT → suggested_import (score 80 diagnostic retained)",
    );
  } else {
    fail("A: expected suggested_import without stale confidence/HRR veto", afterVerified);
  }

  // C — same low-confidence raw parse with no verified correction → review_required
  const noCorrection = computeAutoImportEligibility({
    importStatus: "pending",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parseWarnings: [],
    parsedHeader: cleanJohnstoneHeader,
    parsedLines: cleanLines,
    parsedLineCount: 1,
    pageId: "inv-6169414-raw",
    parserFormatId: "johnstone",
  });
  if (
    noCorrection.importDecisionMode === "review_required" &&
    noCorrection.reviewRequiredReasons.some((r) => /Parser confidence 80 below threshold/i.test(r)) &&
    noCorrection.reviewRequiredReasons.some((r) => /human review required/i.test(r))
  ) {
    pass("C: low-confidence with no verified correction → review_required (stale vetoes still apply)");
  } else {
    fail("C: expected review_required with confidence+HRR vetoes", noCorrection);
  }

  // B/D — verified correction but another real blocker remains → still not suggested
  const stillMissingSo = computeAutoImportEligibility({
    importStatus: "pending",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parseWarnings: [],
    parsedHeader: { ...cleanJohnstoneHeader, vendorOrderNumber: "" },
    parsedLines: cleanLines,
    parsedLineCount: 1,
    pageId: "inv-6169414-partial-gap",
    parserFormatId: "johnstone",
    fieldCorrectionLog: poCorrectionLog,
  });
  if (
    stillMissingSo.importDecisionMode !== "suggested_import" &&
    stillMissingSo.reviewRequiredReasons.some((r) => /Missing S\/O/i.test(r))
  ) {
    pass("B/D: verified PO correction but missing S/O → still review/blocked");
  } else {
    fail("B/D: unresolved S/O gap must still block suggested_import", stillMissingSo);
  }

  // Persisted stale confidence/HRR reasons self-heal via resolve when log matches CURRENT
  const staleConfResolved = resolveAutoImportEligibility({
    importStatus: "pending",
    confidenceScore: 80,
    humanReviewRequired: true,
    duplicate: false,
    parseWarnings: [],
    parsedHeader: cleanJohnstoneHeader,
    parsedLines: cleanLines,
    parsedLineCount: 1,
    pageId: "inv-6169414-stale-persist",
    parserFormatId: "johnstone",
    fieldCorrectionLog: poCorrectionLog,
    autoImportEligible: false,
    importDecisionMode: "review_required",
    suggestedAction: "Review required — inspect fields and match before approve.",
    reviewRequiredReasons: [
      "Parser confidence 80 below threshold 85",
      "Parser flagged human review required",
    ],
    autoImportReasons: [],
  });
  if (staleConfResolved.importDecisionMode === "suggested_import") {
    pass("resolveAutoImportEligibility self-heals persisted stale confidence/HRR after verified correction");
  } else {
    fail("expected persisted stale confidence/HRR to recompute to suggested_import", staleConfResolved);
  }
}

console.log(`\n--- Result: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
console.log("test-auto-import-eligibility: PASS");
