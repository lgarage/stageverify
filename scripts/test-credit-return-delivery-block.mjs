/**
 * Credit/return memos must never create deliveries or appear on default board logic.
 * Run: npm run test:credit-return-delivery-block
 */
import assert from "node:assert/strict";
import {
  creditReturnBlocksDeliveryCreation,
  resolveCreditReturnIngestSkip,
  isCreditReturnImportDoc,
  CREDIT_RETURN_SKIP_REASON,
} from "../functions/lib/invoice/creditReturnSkip.js";
import { computeAutoImportEligibility } from "../functions/lib/invoice/computeAutoImportEligibility.js";

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

console.log("\n=== resolveCreditReturnIngestSkip ===\n");

const now = "2026-08-05T12:00:00.000Z";
const creditLines = [
  {
    lineNumber: 1,
    quantityOrdered: -1,
    quantityShipped: -1,
    quantityBackordered: 0,
    vendorProductNumber: "B50-968",
    description: "return from invoice 123",
    lineType: "return",
    excludeFromExpectedItems: false,
  },
];

const ingestSkip = resolveCreditReturnIngestSkip({
  isNewImport: true,
  creditReturnSkip: true,
  duplicate: false,
  now,
});
if (
  ingestSkip?.reviewStatus === "rejected" &&
  ingestSkip.skipReason === CREDIT_RETURN_SKIP_REASON &&
  ingestSkip.rejectedBy === "system:credit_return_skip"
) {
  pass("new credit import auto-skips to rejected");
} else {
  fail("new credit ingest skip fields", ingestSkip);
}

const noSkipDuplicate = resolveCreditReturnIngestSkip({
  isNewImport: true,
  creditReturnSkip: true,
  duplicate: true,
  now,
});
if (noSkipDuplicate === null) {
  pass("duplicate credit does not auto-skip via structural path");
} else {
  fail("duplicate should not structural-skip", noSkipDuplicate);
}

const preserveSkip = resolveCreditReturnIngestSkip({
  isNewImport: false,
  creditReturnSkip: true,
  duplicate: false,
  now,
  existingRejectedBy: "system:credit_return_skip",
});
if (preserveSkip?.rejectedBy === "system:credit_return_skip") {
  pass("reparse preserves system credit skip");
} else {
  fail("preserve credit skip on reparse", preserveSkip);
}

console.log("\n=== creditReturnBlocksDeliveryCreation ===\n");

const creditDoc = {
  parsedHeader: { vendorBranchName: "Johnstone Supply" },
  parsedLines: creditLines,
  orderNotes: ["CREDIT/return memo"],
};
if (creditReturnBlocksDeliveryCreation(creditDoc)) {
  pass("structural credit doc blocks delivery creation");
} else {
  fail("credit doc should block delivery");
}

const legitDoc = {
  parsedHeader: {
    vendorBranchName: "Johnstone Supply",
    vendorInvoiceNumber: "6164159",
  },
  parsedLines: [
    {
      lineNumber: 1,
      quantityOrdered: 1,
      quantityShipped: 1,
      lineType: "product",
    },
  ],
  orderNotes: [],
};
if (!creditReturnBlocksDeliveryCreation(legitDoc)) {
  pass("normal invoice does not block delivery creation");
} else {
  fail("legit invoice incorrectly blocked");
}

console.log("\n=== computeAutoImportEligibility ===\n");

const creditElig = computeAutoImportEligibility({
  importStatus: "pickup_at_vendor",
  confidenceScore: 95,
  humanReviewRequired: false,
  duplicate: false,
  parsedHeader: creditDoc.parsedHeader,
  parsedLines: creditDoc.parsedLines,
  orderNotes: creditDoc.orderNotes,
  parsedLineCount: 1,
  parserFormatId: "johnstone",
});
if (
  !creditElig.autoImportEligible &&
  creditElig.importDecisionMode === "blocked" &&
  creditElig.reviewRequiredReasons.some((r) => /credit\/return/i.test(r))
) {
  pass("auto-import eligibility blocked for credit memo");
} else {
  fail("credit auto-import should be blocked", creditElig);
}

const legitElig = computeAutoImportEligibility({
  importStatus: "pickup_at_vendor",
  confidenceScore: 95,
  humanReviewRequired: false,
  duplicate: false,
  parsedHeader: legitDoc.parsedHeader,
  parsedLines: legitDoc.parsedLines,
  parsedLineCount: 1,
  parserFormatId: "johnstone",
});
if (
  legitElig.reviewRequiredReasons.every((r) => !/credit\/return/i.test(r))
) {
  pass("legit invoice not blocked as credit");
} else {
  fail("legit invoice incorrectly flagged as credit", legitElig);
}

console.log("\n=== isCreditReturnImportDoc regression ===\n");

if (isCreditReturnImportDoc(creditDoc)) {
  pass("isCreditReturnImportDoc detects negative return lines");
} else {
  fail("credit detection regression");
}

console.log("\n=== mixed invoice vs line-level core/return (doc vs line) ===\n");

/** Literal production false-positive: CORE-16 return line inside a normal invoice. */
const mixedCoreReturnDoc = {
  parsedHeader: {
    vendorBranchName: "Johnstone Supply",
    vendorInvoiceNumber: "6169999",
    customerPoOrReference: "SHOP STOCK PICKUP",
  },
  parsedLines: [
    {
      lineNumber: 1,
      quantityOrdered: 1,
      quantityShipped: 1,
      quantityBackordered: 0,
      vendorProductNumber: "AOX-016",
      description: "R410A CYLINDER",
      lineType: "product",
      excludeFromExpectedItems: false,
      extensionAmount: 120.5,
    },
    {
      lineNumber: 2,
      quantityOrdered: 1,
      quantityShipped: 1,
      quantityBackordered: 0,
      vendorProductNumber: "S81-288",
      description: "MOTOR COND",
      lineType: "product",
      excludeFromExpectedItems: false,
      extensionAmount: 166.14,
    },
    {
      lineNumber: 3,
      quantityOrdered: 1,
      quantityShipped: -1,
      quantityBackordered: 0,
      vendorProductNumber: "CORE-16",
      description: "CORE CHARGE MC ACETYLENE 10C Return from Invoice # 6163055",
      lineType: "core_charge",
      excludeFromExpectedItems: true,
      extensionAmount: -95.25,
    },
  ],
  orderNotes: [],
};

if (!isCreditReturnImportDoc(mixedCoreReturnDoc)) {
  pass("mixed invoice + negative CORE-16 return line is NOT document credit");
} else {
  fail("mixed CORE-16 return incorrectly classified as document credit");
}
if (!creditReturnBlocksDeliveryCreation(mixedCoreReturnDoc)) {
  pass("mixed CORE-16 invoice does not block delivery creation");
} else {
  fail("mixed CORE-16 invoice incorrectly blocked for delivery");
}
const coreLine = mixedCoreReturnDoc.parsedLines[2];
if (
  coreLine.quantityShipped === -1 &&
  coreLine.extensionAmount === -95.25 &&
  /Return from Invoice # 6163055/i.test(coreLine.description) &&
  coreLine.lineType === "core_charge"
) {
  pass("CORE-16 line preserves negative qty, extension, return ref, lineType");
} else {
  fail("CORE-16 line evidence was altered", coreLine);
}

/** inv-6164242 shape: separate negative return-typed line + positive products. */
const mixedReturnLineDoc = {
  parsedHeader: {
    vendorBranchName: "Johnstone Supply",
    vendorInvoiceNumber: "6164242",
    customerPoOrReference: "TOPS STOCK PICKUP",
  },
  parsedLines: [
    {
      lineNumber: 1,
      quantityOrdered: 2,
      quantityShipped: 2,
      vendorProductNumber: "AOX-016",
      description: "R410A CYLINDER",
      lineType: "product",
      excludeFromExpectedItems: false,
    },
    {
      lineNumber: 2,
      quantityOrdered: 1,
      quantityShipped: 1,
      vendorProductNumber: "CORE-16",
      description: "CORE CHARGE",
      lineType: "core_charge",
      excludeFromExpectedItems: true,
    },
    {
      lineNumber: 3,
      quantityOrdered: 1,
      quantityShipped: -1,
      vendorProductNumber: "AOX-045",
      description: "R410A-25 Return from Invoice # 6164000",
      lineType: "return",
      excludeFromExpectedItems: true,
    },
    {
      lineNumber: 4,
      quantityOrdered: 1,
      quantityShipped: 1,
      vendorProductNumber: "AOX-045",
      description: "R410A-25 R410A CYLINDER",
      lineType: "product",
      excludeFromExpectedItems: false,
    },
  ],
  orderNotes: [],
};

if (!isCreditReturnImportDoc(mixedReturnLineDoc)) {
  pass("mixed positive + separate return line is NOT document credit");
} else {
  fail("mixed return-line invoice incorrectly classified as document credit");
}

/** Return-only document (no positive sale lines) — still document credit. */
const returnOnlyDoc = {
  parsedHeader: {
    vendorBranchName: "Johnstone Supply",
    vendorInvoiceNumber: "6169001",
    customerPoOrReference: "STOCK CHECK",
  },
  parsedLines: [
    {
      lineNumber: 1,
      quantityOrdered: 1,
      quantityShipped: -1,
      vendorProductNumber: "AOX-045",
      description: "R410A-25 Return from Invoice # 6164000",
      lineType: "return",
      excludeFromExpectedItems: true,
    },
  ],
  orderNotes: [],
};

if (isCreditReturnImportDoc(returnOnlyDoc)) {
  pass("return-only document still classified as document credit");
} else {
  fail("return-only document lost credit detection");
}
if (creditReturnBlocksDeliveryCreation(returnOnlyDoc)) {
  pass("return-only document still blocks delivery creation");
} else {
  fail("return-only document should still block delivery");
}

console.log(`\ntest-credit-return-delivery-block: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed)\n`);
process.exit(failed === 0 ? 0 : 1);
