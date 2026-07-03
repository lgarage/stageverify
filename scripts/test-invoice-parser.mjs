/**
 * Johnstone invoice parser fixture tests (offline prototype — Slice 1).
 * Run: npm run test:invoice-parser
 *
 * Gate: each approved fixture passes defined expectations from
 * docs/vendor-import/johnstone-invoice-import-spec.md worked examples + Table D.
 */

import { vendorInvoiceImportDisplayLabel } from "../src/dispatcher/invoice/invoiceDisplayHelpers.ts";
import { INVOICE_FIXTURES } from "../src/dispatcher/invoice/invoiceFixtures.ts";
import { pageTextFingerprint } from "../src/dispatcher/invoice/parseJohnstoneInvoice.ts";
import {
  expectedInvoiceLines,
  processInvoicePage,
} from "../src/dispatcher/invoice/processInvoicePage.ts";

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

  if (expected.vendorInvoiceNumber) {
    checks.push({
      label: "vendorInvoiceNumber",
      pass: result.parsed.header.vendorInvoiceNumber === expected.vendorInvoiceNumber,
      detail: result.parsed.header.vendorInvoiceNumber,
    });
  }
  if (expected.customerPoOrReference) {
    checks.push({
      label: "customerPoOrReference",
      pass: result.parsed.header.customerPoOrReference === expected.customerPoOrReference,
      detail: result.parsed.header.customerPoOrReference,
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
};

const failures = [];
const fixtureResults = [];
const existing = {
  byPageId: new Map(),
  byFingerprint: new Map(),
};

for (const fixture of INVOICE_FIXTURES) {
  const result = processInvoicePage(fixture, existing);
  if (result.duplicate) {
    console.log(`SKIP duplicate: ${fixture.pageId}`);
    continue;
  }
  existing.byPageId.set(fixture.pageId, fixture.pageId);
  existing.byFingerprint.set(pageTextFingerprint(fixture), fixture.pageId);

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
