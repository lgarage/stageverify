/**
 * Johnstone invoice parser fixture tests (offline prototype — Slice 1).
 * Run: npm run test:invoice-parser
 *
 * Gate: each approved fixture passes defined expectations from
 * docs/vendor-import/johnstone-invoice-import-spec.md worked examples + Table D.
 */

import { vendorInvoiceImportDisplayLabel } from "../src/dispatcher/invoice/invoiceDisplayHelpers.ts";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import {
  NON_JOHNSTONE_FIXTURE_EXPECTATIONS,
  NON_JOHNSTONE_INVOICE_FIXTURES,
} from "../src/dispatcher/invoice/nonJohnstoneInvoiceFixtures.ts";
import {
  FIRST_SUPPLY_FIXTURE_EXPECTATIONS,
  FIRST_SUPPLY_INVOICE_FIXTURES,
} from "../src/dispatcher/invoice/firstSupplyInvoiceFixtures.ts";
import {
  NOVEL_VENDOR_FIXTURE_EXPECTATIONS,
  NOVEL_VENDOR_INVOICE_FIXTURES,
} from "../src/dispatcher/invoice/novelVendorInvoiceFixtures.ts";
import { pageTextFingerprint } from "../src/dispatcher/invoice/parseJohnstoneInvoice.ts";
import { postProcessExtractedPdfText } from "../functions/src/inboundEmail/normalizePdfText.ts";
import {
  expectedInvoiceLines,
  processInvoicePage,
} from "../src/dispatcher/invoice/processInvoicePage.ts";
import {
  PDF_ATTACHMENT_BOUNDARY,
  extractHeaderInvoiceNumber,
  splitExtractedTextIntoInvoiceDocuments,
} from "../src/dispatcher/invoice/invoiceDocumentSplit.ts";
import { INVOICE_PAGE_BOUNDARY } from "../src/dispatcher/invoice/pdfTextAdapter.ts";
import {
  isCreditReturnImportDoc,
  isCreditReturnInvoice,
  isHiddenExactDuplicateInvoiceImport,
} from "../src/dispatcher/invoice/creditReturnSkip.ts";
import { inferDocumentType } from "../src/dispatcher/invoice/inferDocumentType.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCURACY_GATE = 95;

/** @typedef {{ label: string, pass: boolean, detail?: string }} ExpectResult */

/**
 * @param {import("../src/dispatcher/invoice/types.ts").InvoiceProcessingResult} result
 * @param {Record<string, unknown>} expected
 * @returns {ExpectResult[]}
 */
function evaluateFixture(pageId, result, expected) {
  /** @type {ExpectResult[]} */
  const checks = [];

  if (expected.vendorOrderNumber) {
    checks.push({
      label: "vendorOrderNumber",
      pass: result.parsed.header.vendorOrderNumber === expected.vendorOrderNumber,
      detail: result.parsed.header.vendorOrderNumber,
    });
  }
  if (expected.buyerName) {
    checks.push({
      label: "buyerName",
      pass: result.parsed.header.buyerName === expected.buyerName,
      detail: result.parsed.header.buyerName ?? "null",
    });
  }
  if (expected.vendorInvoiceNumber) {
    checks.push({
      label: "vendorInvoiceNumber",
      pass: result.parsed.header.vendorInvoiceNumber === expected.vendorInvoiceNumber,
      detail: result.parsed.header.vendorInvoiceNumber,
    });
  }
  if (expected.customerAccountNumber) {
    checks.push({
      label: "customerAccountNumber",
      pass: result.parsed.header.customerAccountNumber === expected.customerAccountNumber,
      detail: result.parsed.header.customerAccountNumber,
    });
  }
  if (expected.customerPoOrReference) {
    checks.push({
      label: "customerPoOrReference",
      pass: result.parsed.header.customerPoOrReference === expected.customerPoOrReference,
      detail: result.parsed.header.customerPoOrReference,
    });
  }
  if (expected.shipViaRaw) {
    checks.push({
      label: "shipViaRaw",
      pass: result.parsed.header.shipViaRaw === expected.shipViaRaw,
      detail: result.parsed.header.shipViaRaw ?? "null",
    });
  }
  if (expected.invoiceDate) {
    checks.push({
      label: "invoiceDate",
      pass: result.parsed.header.invoiceDate === expected.invoiceDate,
      detail: result.parsed.header.invoiceDate,
    });
  }
  if (expected.codOnly !== undefined) {
    checks.push({
      label: "codOnly",
      pass: result.parsed.header.codOnly === expected.codOnly,
      detail: `${result.parsed.header.codOnly ?? "null"}`,
    });
  }
  if (expected.paymentTermsRaw) {
    checks.push({
      label: "paymentTermsRaw",
      pass: result.parsed.header.paymentTermsRaw === expected.paymentTermsRaw,
      detail: `${result.parsed.header.paymentTermsRaw ?? "null"}`,
    });
  }
  if (expected.fulfillmentMethod) {
    checks.push({
      label: "fulfillmentMethod",
      pass: result.parsed.header.fulfillmentMethod === expected.fulfillmentMethod,
      detail: result.parsed.header.fulfillmentMethod,
    });
  }
  if (expected.shipCompletePolicy) {
    checks.push({
      label: "shipCompletePolicy",
      pass: result.parsed.header.shipCompletePolicy === expected.shipCompletePolicy,
      detail: result.parsed.header.shipCompletePolicy,
    });
  }
  if (expected.importStatus) {
    checks.push({
      label: "importStatus",
      pass: result.importStatus === expected.importStatus,
      detail: result.importStatus,
    });
  }
  if (expected.displayLabel) {
    const label = vendorInvoiceImportDisplayLabel(result.importStatus);
    checks.push({
      label: "displayLabel",
      pass: label === expected.displayLabel,
      detail: label,
    });
  }
  if (expected.expectedLineCount !== undefined) {
    const count = expectedInvoiceLines(result).length;
    checks.push({
      label: "expectedLineCount",
      pass: count === expected.expectedLineCount,
      detail: `${count}`,
    });
  }
  if (expected.excludedCoreOrReturn !== undefined) {
    const excluded = result.parsed.lines.filter((l) => l.excludeFromExpectedItems).length;
    checks.push({
      label: "excludedCoreOrReturn",
      pass: excluded >= expected.excludedCoreOrReturn,
      detail: `${excluded} excluded`,
    });
  }
  if (expected.notDocumentCredit) {
    const importDoc = {
      parsedHeader: result.parsed.header,
      parsedLines: result.parsed.lines,
      orderNotes: result.parsed.orderNotes ?? [],
    };
    checks.push({
      label: "notDocumentCredit",
      pass:
        !isCreditReturnImportDoc(importDoc) &&
        !isCreditReturnInvoice(result.parsed, result.page.extractedText),
      detail: isCreditReturnImportDoc(importDoc) ? "importDoc credit" : "ok",
    });
  }
  if (expected.quoteNumber) {
    checks.push({
      label: "quoteNumber",
      pass: result.parsed.header.quoteNumber === expected.quoteNumber,
      detail: `${result.parsed.header.quoteNumber ?? "null"}`,
    });
  }
  if (expected.humanReviewRequired !== undefined) {
    checks.push({
      label: "humanReviewRequired",
      pass: result.humanReviewRequired === expected.humanReviewRequired,
      detail: `${result.humanReviewRequired}`,
    });
  }
  if (expected.notAutoProcessed) {
    checks.push({
      label: "notAutoProcessed",
      pass: result.reviewStatus !== "auto_processed",
      detail: result.reviewStatus,
    });
  }
  if (expected.autoProcessed) {
    checks.push({
      label: "autoProcessed",
      pass: result.reviewStatus === "auto_processed",
      detail: result.reviewStatus,
    });
  }
  if (expected.vendorBranchName) {
    checks.push({
      label: "vendorBranchName",
      pass: result.parsed.header.vendorBranchName === expected.vendorBranchName,
      detail: result.parsed.header.vendorBranchName,
    });
  }
  if (expected.vendorBranchAddress) {
    checks.push({
      label: "vendorBranchAddress",
      pass: result.parsed.header.vendorBranchAddress === expected.vendorBranchAddress,
      detail: result.parsed.header.vendorBranchAddress,
    });
  }
  if (expected.vendorBranchPhone) {
    checks.push({
      label: "vendorBranchPhone",
      pass: result.parsed.header.vendorBranchPhone === expected.vendorBranchPhone,
      detail: result.parsed.header.vendorBranchPhone,
    });
  }
  if (expected.soldToName) {
    checks.push({
      label: "soldToName",
      pass: result.parsed.header.soldToName === expected.soldToName,
      detail: result.parsed.header.soldToName,
    });
  }
  if (expected.shipToName) {
    checks.push({
      label: "shipToName",
      pass: result.parsed.header.shipToName === expected.shipToName,
      detail: result.parsed.header.shipToName,
    });
  }
  if (expected.shipToAddress) {
    checks.push({
      label: "shipToAddress",
      pass: result.parsed.header.shipToAddress === expected.shipToAddress,
      detail: result.parsed.header.shipToAddress,
    });
  }
  if (expected.shipDate) {
    checks.push({
      label: "shipDate",
      pass: result.parsed.header.shipDate === expected.shipDate,
      detail: result.parsed.header.shipDate,
    });
  }
  if (expected.lineDescriptionIncludes) {
    const desc = result.parsed.lines[0]?.description ?? "";
    checks.push({
      label: "lineDescriptionIncludes",
      pass: expected.lineDescriptionIncludes.every((s) => desc.includes(s)),
      detail: desc,
    });
  }
  if (expected.lineDescriptionExcludes) {
    const desc = result.parsed.lines[0]?.description ?? "";
    checks.push({
      label: "lineDescriptionExcludes",
      pass: expected.lineDescriptionExcludes.every((s) => !desc.includes(s)),
      detail: desc,
    });
  }

  return checks;
}

/** Approved sample expectations — spec worked examples + Table D. */
const FIXTURE_EXPECTATIONS = {
  "inv-6164159": {
    vendorInvoiceNumber: "6164159",
    customerPoOrReference: "PLANET FITNESS PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 2,
    autoProcessed: true,
  },
  "inv-6163986": {
    vendorInvoiceNumber: "6163986",
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    quoteNumber: "Q618468",
    expectedLineCount: 2,
    notAutoProcessed: true,
  },
  "inv-6164242": {
    vendorInvoiceNumber: "6164242",
    customerPoOrReference: "TOPS STOCK PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 2,
    excludedCoreOrReturn: 2,
    autoProcessed: true,
  },
  "inv-6164100-truck": {
    customerPoOrReference: "TRUCK STOCK PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
  },
  "inv-6164101-exhaust": {
    customerPoOrReference: "EXHAUST FANS PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
  },
  "inv-6164102-kalafat": {
    customerPoOrReference: "KALAFAT Tuesday John",
    fulfillmentMethod: "unknown",
    importStatus: "pending",
    displayLabel: "Pending Delivery",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-pickup-all-backorder": {
    customerPoOrReference: "PLANET FITNESS PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-pickup-partial-backorder": {
    customerPoOrReference: "TRUCK STOCK PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-delivery-all-backorder": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-ambiguous-all-backorder": {
    customerPoOrReference: "KALAFAT Tuesday John",
    fulfillmentMethod: "unknown",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-partial-delivery": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "unknown",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-ship-complete-hold": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "hold_until_complete",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-backorder-truck-delive": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "unknown",
    importStatus: "partial",
    displayLabel: "Partial — order not complete",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-so-4046362": {
    vendorOrderNumber: "4046362",
    customerPoOrReference: "blackduck hartford",
    buyerName: "CONNOR SMITH",
    fulfillmentMethod: "delivery",
    importStatus: "issue",
    displayLabel: "Issue / Action Needed",
    expectedLineCount: 1,
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-so-4046362-colon": {
    vendorOrderNumber: "4046362",
    customerPoOrReference: "blackduck hartford",
    buyerName: "CONNOR SMITH",
    importStatus: "issue",
    displayLabel: "Issue / Action Needed",
    expectedLineCount: 1,
    notAutoProcessed: true,
  },
  "inv-so-4046362-invoice-date": {
    vendorOrderNumber: "4046362",
    customerPoOrReference: "blackduck hartford",
    buyerName: "CONNOR SMITH",
    importStatus: "issue",
    displayLabel: "Issue / Action Needed",
    expectedLineCount: 1,
    notAutoProcessed: true,
  },
  "inv-p411190-4046362": {
    vendorOrderNumber: "4046362",
    vendorInvoiceNumber: "P411190",
    customerAccountNumber: "0008745",
    customerPoOrReference: "blackduck hartfo",
    buyerName: "DAN DAY",
    shipViaRaw: "Fond du Lac",
    invoiceDate: "2026-01-08",
    codOnly: true,
    paymentTermsRaw: "COD ONLY",
    importStatus: "pending",
    displayLabel: "Pending Delivery",
    expectedLineCount: 5,
    notAutoProcessed: true,
  },
  "inv-6166261": {
    vendorInvoiceNumber: "6166261",
    vendorOrderNumber: "6166261",
    customerAccountNumber: "0018114",
    customerPoOrReference: "NTI BOILER",
    buyerName: "CONNOR SMITH",
    shipViaRaw: "PICKUP",
    shipDate: "2026-06-23",
    soldToName: "TWIN PILLAR HEATING & COOLING",
    shipToName: "TWIN PILLAR HEATING & COOLING",
    shipToAddress: "2944 HOLMGREN WAY GREEN BAY WI 54304",
    vendorBranchName: "Johnstone Supply",
    vendorBranchAddress: "335 N Weber Ave Sioux Falls SD 57103",
    vendorBranchPhone: "605-338-2652",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 1,
    autoProcessed: true,
    lineDescriptionIncludes: ["CONTROLLER 210MN", "TX MODELS REQUIRE EXTERNAL SPARK"],
    lineDescriptionExcludes: [
      "Signature Proof of Delivery",
      "Remit To",
      "335 N Weber Ave",
      "GREEN BAY WI 54304",
    ],
  },
  "inv-6167240": {
    vendorInvoiceNumber: "6167240",
    vendorOrderNumber: "6167240",
    customerAccountNumber: "0018114",
    customerPoOrReference: "SAWYER SCHOOL",
    buyerName: "LOGAN SMITH",
    shipViaRaw: "PICKUP",
    orderDate: "2026-07-17",
    invoiceDate: "2026-07-17",
    shipDate: "2026-07-17",
    soldToName: "TWIN PILLAR HEATING & COOLING",
    shipToName: "TWIN PILLAR HEATING & COOLING",
    vendorBranchName: "Johnstone Supply",
    vendorBranchPhone: "605-338-2652",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 2,
    autoProcessed: true,
    lineDescriptionIncludes: ["LINE SET", "MINI-SPLIT"],
  },
  /** C3-B Corpus A — salesman/Ship-Via bleed must yield 2205 EARLY (not …PICKUP). */
  "inv-c3b-2205-early": {
    vendorInvoiceNumber: "6169414",
    vendorOrderNumber: "4049999",
    customerAccountNumber: "0018114",
    customerPoOrReference: "2205 EARLY",
    shipViaRaw: "OUR TRUCK",
    // OUR TRUCK is not TRUCK DELIVE — fulfillment stays unknown (existing infer rules).
    fulfillmentMethod: "unknown",
    importStatus: "pending",
    displayLabel: "Pending Delivery",
    expectedLineCount: 1,
    notAutoProcessed: true,
  },
  /** C3-B Corpus B — bare INVOICE banner digits; Invoice Date on next line must not win. */
  "inv-c3b-invoice-banner": {
    vendorInvoiceNumber: "6168733",
    vendorOrderNumber: "4050001",
    customerAccountNumber: "0018114",
    customerPoOrReference: "STOCK CHECK",
    shipViaRaw: "OUR TRUCK",
    fulfillmentMethod: "unknown",
    importStatus: "pending",
    displayLabel: "Pending Delivery",
    expectedLineCount: 1,
    notAutoProcessed: true,
  },
  /** C3-B negative — RETURN PICKUP preserved despite salesman bleed. */
  "inv-c3b-return-pickup-sad": {
    vendorInvoiceNumber: "6169001",
    vendorOrderNumber: "4050002",
    customerAccountNumber: "0018114",
    customerPoOrReference: "RETURN PICKUP",
    shipViaRaw: "PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 1,
    autoProcessed: true,
  },
  "inv-core-return-mixed": {
    vendorInvoiceNumber: "6169999",
    customerPoOrReference: "SHOP STOCK PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "pickup_at_vendor",
    displayLabel: "Will-Call / Pickup.",
    expectedLineCount: 2,
    excludedCoreOrReturn: 1,
    notDocumentCredit: true,
  },
};

const failures = [];
const fixtureResults = [];
const existing = {
  byPageId: new Map(),
  byFingerprint: new Map(),
};

for (const fixture of INVOICE_FIXTURES) {
  const page = {
    ...fixture,
    extractedText: postProcessExtractedPdfText(fixture.extractedText),
  };
  const result = processInvoicePage(page, existing);
  if (result.duplicate) {
    console.log(`SKIP duplicate: ${fixture.pageId}`);
    continue;
  }
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  existing.byFingerprint.set(pageTextFingerprint(page), fixture.pageId);

  console.log(
    JSON.stringify({
      pageId: fixture.pageId,
      invoice: result.parsed.header.vendorInvoiceNumber,
      po: result.parsed.header.customerPoOrReference,
      fulfillment: result.parsed.header.fulfillmentMethod,
      importStatus: result.importStatus,
      displayLabel: vendorInvoiceImportDisplayLabel(result.importStatus),
      confidence: result.confidenceScore,
      review: result.reviewStatus,
      expectedLines: expectedInvoiceLines(result).length,
    }),
  );

  const expected = FIXTURE_EXPECTATIONS[fixture.pageId];
  if (expected) {
    const checks = evaluateFixture(fixture.pageId, result, expected);
    const passed = checks.every((c) => c.pass);
    fixtureResults.push({ pageId: fixture.pageId, passed, checks });
    if (!passed) {
      for (const c of checks.filter((x) => !x.pass)) {
        failures.push(`${fixture.pageId}: ${c.label} — ${c.detail}`);
      }
    }
  }
}

console.log("\n--- Non-Johnstone vendor fixtures (generic extraction + review) ---");
for (const fixture of NON_JOHNSTONE_INVOICE_FIXTURES) {
  const result = processInvoicePage(fixture, existing);
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  existing.byFingerprint.set(pageTextFingerprint(fixture), fixture.pageId);
  const expected = NON_JOHNSTONE_FIXTURE_EXPECTATIONS[fixture.pageId];
  if (!expected) continue;

  if (result.importStatus !== expected.importStatus) {
    failures.push(
      `${fixture.pageId}: importStatus expected ${expected.importStatus}, got ${result.importStatus}`,
    );
  }
  if (result.humanReviewRequired !== expected.humanReviewRequired) {
    failures.push(`${fixture.pageId}: humanReviewRequired mismatch`);
  }
  if (expected.parserFormatId && result.parserFormatId !== expected.parserFormatId) {
    failures.push(
      `${fixture.pageId}: parserFormatId expected ${expected.parserFormatId}, got ${result.parserFormatId}`,
    );
  }
  if (
    expected.vendorInvoiceNumber &&
    result.parsed.header.vendorInvoiceNumber !== expected.vendorInvoiceNumber
  ) {
    failures.push(`${fixture.pageId}: vendorInvoiceNumber mismatch`);
  }
  if (
    expected.maxConfidenceScore !== undefined &&
    result.confidenceScore > expected.maxConfidenceScore
  ) {
    failures.push(
      `${fixture.pageId}: confidence ${result.confidenceScore} > max ${expected.maxConfidenceScore}`,
    );
  }
  const productLines = expectedInvoiceLines(result).length;
  if (
    expected.minProductLines !== undefined &&
    productLines < expected.minProductLines
  ) {
    failures.push(
      `${fixture.pageId}: expected >= ${expected.minProductLines} lines, got ${productLines}`,
    );
  }
  if (
    expected.maxProductLines !== undefined &&
    productLines > expected.maxProductLines
  ) {
    failures.push(`${fixture.pageId}: unexpected product lines (${productLines})`);
  }
  console.log(
    `  PASS ${fixture.pageId} — format=${result.parserFormatId}, status=${result.importStatus}, confidence=${result.confidenceScore}, lines=${productLines}`,
  );
}

console.log("\n--- Novel vendor fixtures (no dedicated parser) ---");
for (const fixture of NOVEL_VENDOR_INVOICE_FIXTURES) {
  const result = processInvoicePage(fixture, existing);
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  const expected = NOVEL_VENDOR_FIXTURE_EXPECTATIONS[fixture.pageId];
  if (!expected) continue;

  if (result.parserFormatId !== expected.parserFormatId) {
    failures.push(
      `${fixture.pageId}: parserFormatId expected ${expected.parserFormatId}, got ${result.parserFormatId}`,
    );
  }
  if (result.parsed.header.vendorInvoiceNumber !== expected.vendorInvoiceNumber) {
    failures.push(`${fixture.pageId}: vendorInvoiceNumber mismatch`);
  }
  if (result.parsed.header.customerPoOrReference !== expected.customerPoOrReference) {
    failures.push(`${fixture.pageId}: customer P/O mismatch`);
  }
  if (result.importStatus !== expected.importStatus) {
    failures.push(
      `${fixture.pageId}: importStatus expected ${expected.importStatus}, got ${result.importStatus}`,
    );
  }
  if (result.humanReviewRequired !== expected.humanReviewRequired) {
    failures.push(`${fixture.pageId}: humanReviewRequired mismatch`);
  }
  const productLines = expectedInvoiceLines(result).length;
  if (productLines < expected.minProductLines) {
    failures.push(
      `${fixture.pageId}: expected >= ${expected.minProductLines} lines, got ${productLines}`,
    );
  }
  console.log(
    `  PASS ${fixture.pageId} — vendor=${result.detectedVendorName}, inv=${result.parsed.header.vendorInvoiceNumber}, lines=${productLines}`,
  );
}

console.log("\n--- First Supply golden fixtures (Dan PDF extract) ---");
for (const fixture of FIRST_SUPPLY_INVOICE_FIXTURES) {
  const result = processInvoicePage(fixture, existing);
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  const expected = FIRST_SUPPLY_FIXTURE_EXPECTATIONS[fixture.pageId];
  if (!expected) continue;

  if (result.parserFormatId !== expected.parserFormatId) {
    failures.push(
      `${fixture.pageId}: parserFormatId expected ${expected.parserFormatId}, got ${result.parserFormatId}`,
    );
  }
  if (result.parsed.header.vendorInvoiceNumber !== expected.vendorInvoiceNumber) {
    failures.push(
      `${fixture.pageId}: vendorInvoiceNumber expected ${expected.vendorInvoiceNumber}, got ${result.parsed.header.vendorInvoiceNumber}`,
    );
  }
  if (result.parsed.header.customerPoOrReference !== expected.customerPoOrReference) {
    failures.push(`${fixture.pageId}: customer P/O mismatch`);
  }
  if (!result.parsed.header.vendorBranchName.includes(expected.vendorBranchContains)) {
    failures.push(`${fixture.pageId}: branch expected to include ${expected.vendorBranchContains}`);
  }
  if (result.importStatus !== expected.importStatus) {
    failures.push(
      `${fixture.pageId}: importStatus expected ${expected.importStatus}, got ${result.importStatus}`,
    );
  }
  if (result.parsed.header.fulfillmentMethod !== expected.fulfillmentMethod) {
    failures.push(`${fixture.pageId}: fulfillmentMethod mismatch`);
  }
  const productLines = expectedInvoiceLines(result).length;
  if (productLines !== expected.lineCount) {
    failures.push(`${fixture.pageId}: expected ${expected.lineCount} lines, got ${productLines}`);
  }
  console.log(
    `  PASS ${fixture.pageId} — inv=${result.parsed.header.vendorInvoiceNumber}, po=${result.parsed.header.customerPoOrReference}, lines=${productLines}, branch=${result.parsed.header.vendorBranchName}`,
  );
}

console.log("\n--- First Supply multi-invoice document split (Dan PDF) ---");
const multiInvoiceBlob = FIRST_SUPPLY_INVOICE_FIXTURES.map((f) => f.extractedText).join("\n");
const splitDocs = splitExtractedTextIntoInvoiceDocuments(multiInvoiceBlob);
if (splitDocs.length !== 3) {
  failures.push(`document split: expected 3 invoices, got ${splitDocs.length}`);
} else {
  const expectedInvoices = [
    "15047500-00",
    "15046467-00",
    "3869488-00",
  ];
  for (let i = 0; i < splitDocs.length; i += 1) {
    const page = {
      pageId: `inv-firstsupply-split-${i}`,
      importBatchId: "batch-firstsupply-split",
      pageIndexInBatch: i,
      extractedText: splitDocs[i],
    };
    const result = processInvoicePage(page, existing);
    if (result.parsed.header.vendorInvoiceNumber !== expectedInvoices[i]) {
      failures.push(
        `document split block ${i}: expected inv ${expectedInvoices[i]}, got ${result.parsed.header.vendorInvoiceNumber}`,
      );
    }
    if (result.parserFormatId !== "first_supply") {
      failures.push(
        `document split block ${i}: expected parserFormatId first_supply, got ${result.parserFormatId}`,
      );
    }
  }
  console.log(
    `  PASS split → 3 documents (${expectedInvoices.join(", ")})`,
  );
}

console.log("\n--- First Supply multi-page same Invoice # + 1-page sibling ---");
const multiPageSameInvoice = FIRST_SUPPLY_INVOICE_FIXTURES.find(
  (f) => f.pageId === "inv-firstsupply-15046467-00",
);
const singlePageSibling = FIRST_SUPPLY_INVOICE_FIXTURES.find(
  (f) => f.pageId === "inv-firstsupply-3869488-00",
);
if (multiPageSameInvoice && singlePageSibling) {
  const page2Continuation = multiPageSameInvoice.extractedText
    .replace("Page # 1 of 1", "Page # 2 of 2")
    .replace(
      "1 CON10075130 10.00 0.00 10.00 EA 42.13 421.30\n801-R 2X11/2 PRESS COP REDU CPLG 10075130",
      "7 EXTRA-PAGE2 1.00 0.00 1.00 EA 1.00 1.00\nEXTRA LINE PAGE TWO",
    );
  const mixedBlob = [
    multiPageSameInvoice.extractedText,
    page2Continuation,
    singlePageSibling.extractedText,
  ].join("\n");
  const mixedDocs = splitExtractedTextIntoInvoiceDocuments(mixedBlob);
  if (mixedDocs.length !== 2) {
    failures.push(
      `multi-page same # split: expected 2 invoices, got ${mixedDocs.length}`,
    );
  } else {
    const first = processInvoicePage(
      {
        pageId: "inv-firstsupply-multipage-a",
        importBatchId: "batch-firstsupply-multipage",
        pageIndexInBatch: 0,
        extractedText: mixedDocs[0],
      },
      existing,
    );
    const second = processInvoicePage(
      {
        pageId: "inv-firstsupply-multipage-b",
        importBatchId: "batch-firstsupply-multipage",
        pageIndexInBatch: 1,
        extractedText: mixedDocs[1],
      },
      existing,
    );
    if (first.parsed.header.vendorInvoiceNumber !== "15046467-00") {
      failures.push(
        `multi-page same #: expected first inv 15046467-00, got ${first.parsed.header.vendorInvoiceNumber}`,
      );
    }
    if (second.parsed.header.vendorInvoiceNumber !== "3869488-00") {
      failures.push(
        `multi-page same #: expected second inv 3869488-00, got ${second.parsed.header.vendorInvoiceNumber}`,
      );
    }
    const firstLines = expectedInvoiceLines(first).length;
    if (firstLines < 6) {
      failures.push(
        `multi-page same #: expected merged page lines ≥6 on 15046467-00, got ${firstLines}`,
      );
    }
    console.log(
      `  PASS multi-page same # → 2 documents (15046467-00 pages merged, 3869488-00 alone); lines=${firstLines}`,
    );
  }
} else {
  failures.push("multi-page same #: missing First Supply fixtures");
}

console.log("\n--- Generic multi-invoice document split ---");

const genericTwoInvoiceBlob = [
  NOVEL_VENDOR_INVOICE_FIXTURES[0].extractedText,
  NOVEL_VENDOR_INVOICE_FIXTURES[1].extractedText,
].join("\n\n");
const genericSplitDocs = splitExtractedTextIntoInvoiceDocuments(genericTwoInvoiceBlob);
if (genericSplitDocs.length !== 2) {
  failures.push(`generic split: expected 2 invoices, got ${genericSplitDocs.length}`);
} else {
  const genericExpected = [
    NOVEL_VENDOR_FIXTURE_EXPECTATIONS["inv-monroe-equipment-001"].vendorInvoiceNumber,
    NOVEL_VENDOR_FIXTURE_EXPECTATIONS["inv-gustave-larson-001"].vendorInvoiceNumber,
  ];
  for (let i = 0; i < genericSplitDocs.length; i += 1) {
    const page = {
      pageId: `inv-generic-split-${i}`,
      importBatchId: "batch-generic-split",
      pageIndexInBatch: i,
      extractedText: genericSplitDocs[i],
    };
    const result = processInvoicePage(page, existing);
    if (result.parsed.header.vendorInvoiceNumber !== genericExpected[i]) {
      failures.push(
        `generic split block ${i}: expected inv ${genericExpected[i]}, got ${result.parsed.header.vendorInvoiceNumber}`,
      );
    }
    if (result.parserFormatId !== "generic") {
      failures.push(
        `generic split block ${i}: expected parserFormatId generic, got ${result.parserFormatId}`,
      );
    }
  }
  console.log(`  PASS generic concat → 2 documents (${genericExpected.join(", ")})`);
}

const fergusonA = NON_JOHNSTONE_INVOICE_FIXTURES[0].extractedText;
const fergusonB = NON_JOHNSTONE_INVOICE_FIXTURES[2].extractedText;
const fergusonSplitDocs = splitExtractedTextIntoInvoiceDocuments(
  `${fergusonA}\n\n${fergusonB}`,
);
if (fergusonSplitDocs.length !== 2) {
  failures.push(`ferguson split: expected 2 invoices, got ${fergusonSplitDocs.length}`);
} else {
  const fergusonExpected = ["FE-882145", "FE-990011"];
  for (let i = 0; i < fergusonSplitDocs.length; i += 1) {
    const page = {
      pageId: `inv-ferguson-split-${i}`,
      importBatchId: "batch-ferguson-split",
      pageIndexInBatch: i,
      extractedText: fergusonSplitDocs[i],
    };
    const result = processInvoicePage(page, existing);
    if (result.parsed.header.vendorInvoiceNumber !== fergusonExpected[i]) {
      failures.push(
        `ferguson split block ${i}: expected inv ${fergusonExpected[i]}, got ${result.parsed.header.vendorInvoiceNumber}`,
      );
    }
  }
  console.log(`  PASS ferguson concat → 2 documents (${fergusonExpected.join(", ")})`);
}

const johnstonePageA = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 6164999
Invoice #: 6164999
Customer P/O #: MULTI PAGE SPLIT TEST
`.trim();
const johnstonePageB = `
LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 TH8320R1003/U THERMOSTAT
please call 605-338-2652
`.trim();
const johnstoneMultiPageBlob = `${johnstonePageA}${INVOICE_PAGE_BOUNDARY}${johnstonePageB}`;
const johnstoneSplitDocs = splitExtractedTextIntoInvoiceDocuments(johnstoneMultiPageBlob);
if (johnstoneSplitDocs.length !== 1) {
  failures.push(
    `johnstone multi-page split: expected 1 document, got ${johnstoneSplitDocs.length}`,
  );
} else {
  const johnstonePage = {
    pageId: "inv-johnstone-multipage-split",
    importBatchId: "batch-johnstone-multipage-split",
    pageIndexInBatch: 0,
    extractedText: johnstoneSplitDocs[0],
  };
  const johnstoneResult = processInvoicePage(johnstonePage, existing);
  if (johnstoneResult.parsed.header.vendorInvoiceNumber !== "6164999") {
    failures.push(
      `johnstone multi-page split: expected inv 6164999, got ${johnstoneResult.parsed.header.vendorInvoiceNumber}`,
    );
  }
  console.log("  PASS johnstone multi-page boundary → 1 document (6164999)");
}

console.log("\n--- Johnstone Sioux Falls 4-page PDF document split ---");
const siouxFixturePath = join(__dirname, "fixtures", "sioux-falls-4page-20260725.txt");
const siouxExtracted = postProcessExtractedPdfText(
  readFileSync(siouxFixturePath, "utf8"),
);
const siouxSplitDocs = splitExtractedTextIntoInvoiceDocuments(siouxExtracted);
const siouxExpectedInvoices = ["6167746", "6167990", "6168008"];
if (siouxSplitDocs.length < 4) {
  failures.push(
    `sioux falls split: expected >= 4 documents, got ${siouxSplitDocs.length}`,
  );
} else {
  const headerNumbers = siouxSplitDocs.map((doc) => extractHeaderInvoiceNumber(doc));
  for (const inv of siouxExpectedInvoices) {
    if (!headerNumbers.includes(inv)) {
      failures.push(`sioux falls split: missing invoice # ${inv} in split headers`);
    }
  }
  const creditDoc = siouxSplitDocs.find((doc) => /^\s*CREDIT\b/m.test(doc));
  if (!creditDoc) {
    failures.push("sioux falls split: expected a CREDIT memo document");
  } else if (extractHeaderInvoiceNumber(creditDoc) !== "3316448A") {
    failures.push(
      `sioux falls split: CREDIT doc expected header inv 3316448A, got ${extractHeaderInvoiceNumber(creditDoc) || "(empty)"}`,
    );
  } else {
    const creditPage = {
      pageId: "inv-sioux-credit-skip",
      importBatchId: "batch-sioux-credit-skip",
      pageIndexInBatch: 0,
      extractedText: creditDoc,
    };
    const creditResult = processInvoicePage(creditPage, existing);
    if (creditResult.reviewStatus !== "pending_review") {
      failures.push(
        `sioux falls CREDIT doc: expected reviewStatus pending_review (manual reject), got ${creditResult.reviewStatus}`,
      );
    }
    if (creditResult.parsed.header.vendorInvoiceNumber !== "3316448A") {
      failures.push(
        `sioux falls CREDIT doc: expected vendorInvoiceNumber 3316448A, got ${creditResult.parsed.header.vendorInvoiceNumber || "(empty)"}`,
      );
    }
    if (creditResult.parsed.header.customerAccountNumber !== "0018114") {
      failures.push(
        `sioux falls CREDIT doc: expected customerAccountNumber 0018114, got ${creditResult.parsed.header.customerAccountNumber || "(empty)"}`,
      );
    }
    if (!/GAVIN\s+PHILIPPON/i.test(creditResult.parsed.header.buyerName ?? "")) {
      failures.push(
        `sioux falls CREDIT doc: expected buyer GAVIN PHILIPPON, got ${creditResult.parsed.header.buyerName || "(empty)"}`,
      );
    }
    if (/^CREDIT$/i.test(creditResult.parsed.header.vendorBranchName ?? "")) {
      failures.push(
        "sioux falls CREDIT doc: vendorBranchName must not be bare CREDIT",
      );
    }
    if (creditResult.parsed.lines.length < 1) {
      failures.push(
        `sioux falls CREDIT doc: expected >=1 parsed line, got ${creditResult.parsed.lines.length}`,
      );
    }
    const creditProduct = creditResult.parsed.lines.find((l) =>
      /^B50-968$/i.test(l.vendorProductNumber ?? ""),
    );
    if (!creditProduct) {
      failures.push("sioux falls CREDIT doc: expected line product B50-968");
    }
    if (
      !isCreditReturnInvoice(creditResult.parsed, creditDoc) ||
      !isCreditReturnImportDoc({
        parsedHeader: creditResult.parsed.header,
        parsedLines: creditResult.parsed.lines,
        orderNotes: creditResult.parsed.orderNotes,
      })
    ) {
      failures.push(
        "sioux falls CREDIT doc: expected credit/return advisory detection without Branch=CREDIT",
      );
    }
    if (creditResult.importStatus === "issue") {
      failures.push(
        `sioux falls CREDIT doc: importStatus should not be issue after parse, got ${creditResult.importStatus}`,
      );
    }
  }
  console.log(
    `  PASS sioux falls 4-page → ${siouxSplitDocs.length} documents (CREDIT/3316448A, ${siouxExpectedInvoices.join(", ")})`,
  );
}

console.log("\n--- Branch CREDIT header-only (0 lines) pending advisory ---");
{
  const branchCreditText =
    "Customer # Order Date Sales Order # Buyer Customer P/O # Ship Via\n" +
    "12345 2026-07-24 Buyer Ship Via Sales Customer P/O\n" +
    "BRANCH CREDIT\n";
  const branchCreditPage = {
    pageId: "inv-branch-credit-skip",
    importBatchId: "batch-branch-credit-skip",
    pageIndexInBatch: 0,
    extractedText: branchCreditText,
  };
  const branchCreditResult = processInvoicePage(branchCreditPage, existing);
  if (branchCreditResult.reviewStatus !== "pending_review") {
    failures.push(
      `branch CREDIT 0-line doc: expected reviewStatus pending_review, got ${branchCreditResult.reviewStatus}`,
    );
  }
  if (
    !isCreditReturnInvoice(branchCreditResult.parsed, branchCreditPage.extractedText)
  ) {
    failures.push("branch CREDIT 0-line doc: isCreditReturnInvoice should be true");
  }
  const headerOnlyCredit = {
    parsedHeader: { vendorBranchName: "CREDIT" },
    parsedLines: [],
    orderNotes: [],
  };
  if (!isCreditReturnImportDoc(headerOnlyCredit)) {
    failures.push("vendorBranchName CREDIT: isCreditReturnImportDoc should be true");
  }
  if (/^CREDIT$/i.test(branchCreditResult.parsed.header.vendorBranchName ?? "")) {
    failures.push(
      "branch CREDIT 0-line doc: vendorBranchName must not be bare CREDIT after parse",
    );
  }
  console.log("  PASS branch CREDIT header-only → pending advisory + import-doc detection");
}

console.log("\n--- Canonical label-row poison must not become header values ---");
{
  const labelPoisonText = `CREDIT
Page 1/1
Sold To Ship To
Customer # Order Date Sales Order # Buyer Customer P/O # Ship Via Salesman
Invoice # Invoice Date Ship Date
LN QNTY ORD QNTY SHIP`;
  const poisonPage = {
    pageId: "inv-credit-label-poison",
    importBatchId: "batch-credit-label-poison",
    pageIndexInBatch: 0,
    extractedText: labelPoisonText,
  };
  const poisonResult = processInvoicePage(poisonPage, existing);
  const h = poisonResult.parsed.header;
  if (h.customerAccountNumber === "Order" || /^(?:Order|Buyer)$/i.test(h.customerAccountNumber ?? "")) {
    failures.push(
      `label poison: customerAccountNumber must not be a label token, got ${h.customerAccountNumber || "(empty)"}`,
    );
  }
  if (h.vendorOrderNumber === "Buyer" || /^Buyer$/i.test(h.vendorOrderNumber ?? "")) {
    failures.push(
      `label poison: vendorOrderNumber must not be Buyer, got ${h.vendorOrderNumber || "(empty)"}`,
    );
  }
  if (/Ship\s+Via|Salesman|Customer\s+P\/O/i.test(h.buyerName ?? "")) {
    failures.push(
      `label poison: buyerName must not contain header labels, got ${h.buyerName || "(empty)"}`,
    );
  }
  if (/^Ship\s+To$/i.test(h.soldToName ?? "")) {
    failures.push("label poison: soldToName must not be Ship To");
  }
  if (/^CREDIT$/i.test(h.vendorBranchName ?? "")) {
    failures.push("label poison: vendorBranchName must not be CREDIT");
  }
  if (!isCreditReturnInvoice(poisonResult.parsed, labelPoisonText)) {
    failures.push("label poison CREDIT doc: isCreditReturnInvoice should still be true");
  }
  console.log("  PASS label-row poison rejected; CREDIT advisory signals preserved");
}

console.log("\n--- Mixed invoice: line-item credit must not classify the document ---");
{
  const mixedInvoiceText = `
Johnstone Supply
Remit To: Johnstone Supply
335 N Weber Ave
Sioux Falls SD 57103

Customer #: 0018114
Sales Order #: 6169001
Invoice #: 6169001
Customer P/O #: PLANET FITNESS PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Ship Date: 06/23/2026
Buyer: CONNOR SMITH

Sold To: TWIN PILLAR HEATING & COOLING
Ship To: TWIN PILLAR HEATING & COOLING
2944 HOLMGREN WAY, GREEN BAY WI 54304

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 TH8320R1003/U THERMOSTAT PROGRAMMABLE
2 1 -1 0 B50-968 ZP31LXEPFV800 COMPRESSOR
Return from Invoice # 3314154A
3 2 2 0 B86-380 4050-08 SEALANT REFRIGERATIO

please call 605-338-2652
`.trim();
  const mixedPage = {
    pageId: "inv-mixed-one-credit-line",
    importBatchId: "batch-mixed-credit-line",
    pageIndexInBatch: 0,
    extractedText: mixedInvoiceText,
  };
  const mixedResult = processInvoicePage(mixedPage, existing);
  const mixedImport = {
    parsedHeader: mixedResult.parsed.header,
    parsedLines: mixedResult.parsed.lines,
    orderNotes: mixedResult.parsed.orderNotes,
    skipReason: undefined,
    importStatus: mixedResult.importStatus,
    pageId: mixedPage.pageId,
  };
  const returnLines = mixedResult.parsed.lines.filter((l) => l.lineType === "return");
  const productLines = mixedResult.parsed.lines.filter((l) => l.lineType === "product");
  const expectedLines = expectedInvoiceLines(mixedResult);
  if (isCreditReturnInvoice(mixedResult.parsed, mixedInvoiceText)) {
    failures.push("mixed invoice: isCreditReturnInvoice should be false for one credited line");
  }
  if (isCreditReturnImportDoc(mixedImport)) {
    failures.push("mixed invoice: isCreditReturnImportDoc should be false for one credited line");
  }
  if (inferDocumentType(mixedImport) === "credit_memo") {
    failures.push("mixed invoice: inferDocumentType must not be credit_memo");
  }
  if (mixedResult.parsed.orderNotes.some((n) => /CREDIT\/return memo/i.test(n))) {
    failures.push("mixed invoice: must not stamp CREDIT/return memo on a normal invoice");
  }
  if (returnLines.length !== 1 || !/^B50-968$/i.test(returnLines[0]?.vendorProductNumber ?? "")) {
    failures.push(
      `mixed invoice: expected exactly one return line B50-968, got ${returnLines.map((l) => l.vendorProductNumber).join(",") || "(none)"}`,
    );
  }
  if (productLines.length < 2) {
    failures.push(
      `mixed invoice: expected >=2 product lines to remain, got ${productLines.length}`,
    );
  }
  if (expectedLines.some((l) => l.lineType === "return" || l.quantityShipped < 0)) {
    failures.push("mixed invoice: expected items must exclude the credited line");
  }
  if (!expectedLines.some((l) => /^L46-668$/i.test(l.vendorProductNumber ?? ""))) {
    failures.push("mixed invoice: thermostat product line must remain expected");
  }

  const multiCreditText = mixedInvoiceText.replace(
    "3 2 2 0 B86-380 4050-08 SEALANT REFRIGERATIO",
    "3 1 -1 0 B86-380 4050-08 SEALANT REFRIGERATIO\nReturn from Invoice # 3314000A",
  );
  const multiResult = processInvoicePage(
    {
      pageId: "inv-mixed-two-credit-lines",
      importBatchId: "batch-mixed-credit-line",
      pageIndexInBatch: 1,
      extractedText: multiCreditText,
    },
    existing,
  );
  const multiReturns = multiResult.parsed.lines.filter((l) => l.lineType === "return");
  const multiProducts = multiResult.parsed.lines.filter((l) => l.lineType === "product");
  if (
    isCreditReturnInvoice(multiResult.parsed, multiCreditText) ||
    isCreditReturnImportDoc({
      parsedHeader: multiResult.parsed.header,
      parsedLines: multiResult.parsed.lines,
      orderNotes: multiResult.parsed.orderNotes,
    })
  ) {
    failures.push("mixed invoice: two credited lines must not classify the document as a return");
  }
  if (multiReturns.length !== 2) {
    failures.push(`mixed invoice: expected 2 return lines, got ${multiReturns.length}`);
  }
  if (multiProducts.length < 1) {
    failures.push("mixed invoice: remaining purchased line must stay a product");
  }
  const returnPickupPurchasedText = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 6169100
Invoice #: 6169100
Customer P/O #: RETURN PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Buyer: CONNOR SMITH

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 1 0 L46-668 TH8320R1003/U THERMOSTAT PROGRAMMABLE

please call 605-338-2652
`.trim();
  const returnPickupPurchased = processInvoicePage(
    {
      pageId: "inv-return-pickup-purchased",
      importBatchId: "batch-mixed-credit-line",
      pageIndexInBatch: 2,
      extractedText: returnPickupPurchasedText,
    },
    existing,
  );
  if (
    isCreditReturnInvoice(returnPickupPurchased.parsed, returnPickupPurchasedText) ||
    isCreditReturnImportDoc({
      parsedHeader: returnPickupPurchased.parsed.header,
      parsedLines: returnPickupPurchased.parsed.lines,
      orderNotes: returnPickupPurchased.parsed.orderNotes,
    }) ||
    returnPickupPurchased.parsed.orderNotes.some((n) => /CREDIT\/return memo/i.test(n))
  ) {
    failures.push(
      "RETURN PICKUP + purchased product: must not classify as document credit or stamp CREDIT/return memo",
    );
  }

  const returnPickupAllReturnText = `
Johnstone Supply
Customer #: 0018114
Sales Order #: 3317000
Invoice #: 3317000A
Customer P/O #: RETURN PICKUP
Order Date: 06/23/2026
Invoice Date: 06/23/2026
Buyer: CONNOR SMITH

LN QNTY ORD QNTY SHIP QNTY B/O PRODUCT NUMBER DESCRIPTION
1 1 -1 0 B50-968 ZP31LXEPFV800 COMPRESSOR
Return from Invoice # 3314154A

please call 605-338-2652
`.trim();
  const returnPickupAllReturn = processInvoicePage(
    {
      pageId: "inv-return-pickup-all-return",
      importBatchId: "batch-mixed-credit-line",
      pageIndexInBatch: 3,
      extractedText: returnPickupAllReturnText,
    },
    existing,
  );
  if (
    !isCreditReturnInvoice(returnPickupAllReturn.parsed, returnPickupAllReturnText) ||
    !isCreditReturnImportDoc({
      parsedHeader: returnPickupAllReturn.parsed.header,
      parsedLines: returnPickupAllReturn.parsed.lines,
      orderNotes: returnPickupAllReturn.parsed.orderNotes,
    })
  ) {
    failures.push(
      "RETURN PICKUP + all-return lines: must still classify as document credit",
    );
  }
  console.log("  PASS mixed invoice keeps document classification; credits stay line-level");
}

console.log("\n--- Mixed CORE-16 return line evidence preserved (doc not credit) ---");
{
  const coreMixedPage = INVOICE_FIXTURES.find((f) => f.pageId === "inv-core-return-mixed");
  if (!coreMixedPage) {
    failures.push("inv-core-return-mixed fixture missing");
  } else {
    const coreMixed = processInvoicePage(coreMixedPage, existing);
    const coreLine = coreMixed.parsed.lines.find((l) =>
      /^CORE-/i.test(l.vendorProductNumber ?? ""),
    );
    if (!coreLine) {
      failures.push("inv-core-return-mixed: expected CORE-* line");
    } else {
      if (coreLine.quantityShipped !== -1) {
        failures.push(
          `inv-core-return-mixed: CORE qty expected -1, got ${coreLine.quantityShipped}`,
        );
      }
      if (coreLine.lineType !== "core_charge") {
        failures.push(
          `inv-core-return-mixed: CORE lineType expected core_charge, got ${coreLine.lineType}`,
        );
      }
      if (!coreLine.excludeFromExpectedItems) {
        failures.push("inv-core-return-mixed: CORE line should excludeFromExpectedItems");
      }
      if (!/return from invoice\s*#\s*6163055/i.test(coreLine.description ?? "")) {
        failures.push(
          `inv-core-return-mixed: CORE description missing Return from Invoice # ref, got "${coreLine.description}"`,
        );
      }
    }
    const productLines = coreMixed.parsed.lines.filter((l) => l.lineType === "product");
    if (productLines.length < 2) {
      failures.push(
        `inv-core-return-mixed: expected >=2 purchased product lines, got ${productLines.length}`,
      );
    }
    const coreImportDoc = {
      parsedHeader: coreMixed.parsed.header,
      parsedLines: coreMixed.parsed.lines,
      orderNotes: coreMixed.parsed.orderNotes ?? [],
    };
    if (isCreditReturnImportDoc(coreImportDoc)) {
      failures.push("inv-core-return-mixed: isCreditReturnImportDoc should be false");
    }
    if (isCreditReturnInvoice(coreMixed.parsed, coreMixedPage.extractedText)) {
      failures.push("inv-core-return-mixed: isCreditReturnInvoice should be false");
    }
    if (inferDocumentType({ ...coreImportDoc, pageId: coreMixedPage.pageId }) === "credit_memo") {
      failures.push("inv-core-return-mixed: inferDocumentType must not be credit_memo");
    }
    console.log("  PASS inv-core-return-mixed — line evidence kept; document not credit/return");
  }
}

const attachmentSplitDocs = splitExtractedTextIntoInvoiceDocuments(
  `${fergusonA}${PDF_ATTACHMENT_BOUNDARY}${fergusonB}`,
);
if (attachmentSplitDocs.length !== 2) {
  failures.push(
    `PDF attachment split: expected 2 invoices, got ${attachmentSplitDocs.length}`,
  );
} else {
  const attachmentExpected = ["FE-882145", "FE-990011"];
  for (let i = 0; i < attachmentSplitDocs.length; i += 1) {
    const page = {
      pageId: `inv-attachment-split-${i}`,
      importBatchId: "batch-attachment-split",
      pageIndexInBatch: i,
      extractedText: attachmentSplitDocs[i],
    };
    const result = processInvoicePage(page, existing);
    if (result.parsed.header.vendorInvoiceNumber !== attachmentExpected[i]) {
      failures.push(
        `PDF attachment split block ${i}: expected inv ${attachmentExpected[i]}, got ${result.parsed.header.vendorInvoiceNumber}`,
      );
    }
  }
  console.log(
    `  PASS PDF attachment boundary → 2 documents (${attachmentExpected.join(", ")})`,
  );
}

const dupFingerprint = processInvoicePage(INVOICE_FIXTURES[6], {
  byPageId: new Map(),
  byFingerprint: new Map([[pageTextFingerprint(INVOICE_FIXTURES[0]), INVOICE_FIXTURES[0].pageId]]),
});
if (!dupFingerprint.duplicate) failures.push("duplicate content fingerprint not detected");

{
  if (
    !isHiddenExactDuplicateInvoiceImport({
      skipReason: "duplicate_business_invoice",
    })
  ) {
    failures.push("isHiddenExactDuplicateInvoiceImport: skipReason duplicate should hide");
  }
  if (
    !isHiddenExactDuplicateInvoiceImport({
      rejectedBy: "system:duplicate_business_invoice",
    })
  ) {
    failures.push(
      "isHiddenExactDuplicateInvoiceImport: rejectedBy system duplicate fallback should hide",
    );
  }
  if (
    isHiddenExactDuplicateInvoiceImport({
      skipReason: "credit_return",
      rejectedBy: "system:credit_return_skip",
    })
  ) {
    failures.push("isHiddenExactDuplicateInvoiceImport: credit_return must not hide");
  }
  if (
    isHiddenExactDuplicateInvoiceImport({
      skipReason: "document_ignore",
      rejectedBy: "system:document_ignore_skip",
    })
  ) {
    failures.push("isHiddenExactDuplicateInvoiceImport: document_ignore must not hide");
  }
  if (
    isHiddenExactDuplicateInvoiceImport({
      reviewStatus: "pending_review",
    })
  ) {
    failures.push("isHiddenExactDuplicateInvoiceImport: pending without skip must not hide");
  }
  if (isHiddenExactDuplicateInvoiceImport(undefined)) {
    failures.push("isHiddenExactDuplicateInvoiceImport: undefined must not hide");
  }
  console.log("  PASS isHiddenExactDuplicateInvoiceImport — duplicate hides; other skips do not");
}

const scored = fixtureResults.length;
const passedCount = fixtureResults.filter((r) => r.passed).length;
const accuracyPct = scored > 0 ? Math.round((passedCount / scored) * 1000) / 10 : 0;

console.log("\n--- Johnstone invoice fixture accuracy report ---");
console.log(
  "Scoring: each approved fixture passes when header/fulfillment/status/labels/lines match spec.",
);
console.log(`Gate: ≥${ACCURACY_GATE}% on approved sample set (${scored} fixtures).`);
for (const row of fixtureResults) {
  const status = row.passed ? "PASS" : "FAIL";
  const failedChecks = row.checks.filter((c) => !c.pass).map((c) => c.label);
  console.log(
    `  ${status} ${row.pageId}${failedChecks.length ? ` (${failedChecks.join(", ")})` : ""}`,
  );
}
console.log(`Aggregate: ${passedCount}/${scored} = ${accuracyPct}%`);
console.log(`Gate ${accuracyPct >= ACCURACY_GATE ? "PASS" : "FAIL"} (threshold ${ACCURACY_GATE}%)`);

if (accuracyPct < ACCURACY_GATE) {
  failures.push(`accuracy gate: ${accuracyPct}% < ${ACCURACY_GATE}%`);
}

if (failures.length) {
  console.error("\nFAIL invoice tests:", failures);
  process.exit(1);
}

console.log("\nPASS Johnstone invoice parser fixture tests");
