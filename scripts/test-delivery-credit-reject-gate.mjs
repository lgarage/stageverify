/**
 * Delivery drawer reject gate — approved credit/return slip-throughs must be rejectable.
 * Run: npm run test:delivery-credit-reject-gate
 */
import assert from "node:assert/strict";
import {
  canRejectLinkedImport,
  isCreditReturnLinkedImport,
  linkedImportRejectBlockedReason,
} from "../src/dispatcher/invoice/deliveryCreditReturn.ts";

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

const siouxCreditLines = [
  {
    lineNumber: 1,
    quantityOrdered: -1,
    quantityShipped: -1,
    quantityBackordered: 0,
    vendorProductNumber: "B50-968",
    description: "return from invoice 6167746",
    lineType: "return",
    excludeFromExpectedItems: false,
  },
];

const siouxCreditApproved = {
  id: "import-sioux-credit-approved",
  reviewStatus: "approved",
  parsedHeader: {
    header: {
      vendorBranchName: "Johnstone Supply — Sioux Falls",
      customerPoOrReference: "JOB-123",
      vendorInvoiceNumber: "6167746A",
    },
  },
  parsedLines: siouxCreditLines,
  orderNotes: ["CREDIT/return memo"],
  reviewRequiredReasons: ["Credit/return memo — not valid for delivery import"],
};

console.log("\n=== isCreditReturnLinkedImport (nested header + string qty) ===\n");

if (isCreditReturnLinkedImport(siouxCreditApproved)) {
  pass("approved slip-through detected via nested header + return lines");
} else {
  fail("sioux-style approved credit should be linked credit/return");
}

console.log("\n=== canRejectLinkedImport (mirrors CF canRejectReviewStatus) ===\n");

if (canRejectLinkedImport(siouxCreditApproved)) {
  pass("approved credit slip-through can reject from drawer");
} else {
  fail("approved credit slip-through should pass canRejectLinkedImport");
}

const normalApproved = {
  id: "import-normal-approved",
  reviewStatus: "approved",
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
      description: "Filter drier",
    },
  ],
  orderNotes: [],
};

if (!canRejectLinkedImport(normalApproved)) {
  pass("normal approved invoice cannot reject from drawer");
} else {
  fail("normal approved invoice should stay blocked");
}

console.log("\n=== linkedImportRejectBlockedReason ===\n");

const blockedReason = linkedImportRejectBlockedReason(
  normalApproved,
  normalApproved.id,
);
if (
  blockedReason &&
  blockedReason.includes("approved") &&
  blockedReason.includes("credit/return")
) {
  pass("normal approved import shows blocked reason");
} else {
  fail("expected blocked reason for normal approved import", blockedReason);
}

const creditReason = linkedImportRejectBlockedReason(
  siouxCreditApproved,
  siouxCreditApproved.id,
);
if (creditReason === null) {
  pass("approved credit slip-through has no blocked reason");
} else {
  fail("approved credit slip-through should not be blocked", creditReason);
}

const stringQtyCredit = {
  ...siouxCreditApproved,
  parsedLines: [
    {
      ...siouxCreditLines[0],
      quantityShipped: "-1",
      quantityOrdered: "-1",
    },
  ],
};

if (canRejectLinkedImport(stringQtyCredit)) {
  pass("string negative qty coerces for reject gate");
} else {
  fail("string qty credit slip-through should be rejectable");
}

console.log(
  `\ntest-delivery-credit-reject-gate: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed)\n`,
);
process.exit(failed === 0 ? 0 : 1);
