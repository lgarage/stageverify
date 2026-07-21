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
  splitExtractedTextIntoInvoiceDocuments,
} from "../src/dispatcher/invoice/invoiceDocumentSplit.ts";
import { INVOICE_PAGE_BOUNDARY } from "../src/dispatcher/invoice/pdfTextAdapter.ts";

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
    displayLabel: "Partial",
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
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-pickup-partial-backorder": {
    customerPoOrReference: "TRUCK STOCK PICKUP",
    fulfillmentMethod: "will_call_pickup",
    importStatus: "partial",
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-delivery-all-backorder": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    importStatus: "partial",
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-ambiguous-all-backorder": {
    customerPoOrReference: "KALAFAT Tuesday John",
    fulfillmentMethod: "unknown",
    importStatus: "partial",
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-partial-delivery": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "unknown",
    importStatus: "partial",
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-ship-complete-hold": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "hold_until_complete",
    importStatus: "partial",
    displayLabel: "Partial",
    humanReviewRequired: true,
    notAutoProcessed: true,
  },
  "inv-backorder-truck-delive": {
    customerPoOrReference: "La Crosse PF",
    fulfillmentMethod: "delivery",
    shipCompletePolicy: "unknown",
    importStatus: "partial",
    displayLabel: "Partial",
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
