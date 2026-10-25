import assert from "node:assert/strict";
import { filterVendorRunDeliveriesBySearch } from "../src/dispatcher/vendorRunListSearch.ts";

function row(overrides = {}) {
  return {
    deliveryId: overrides.deliveryId ?? "d1",
    vendorInvoiceNumber: overrides.vendorInvoiceNumber,
    poNumber: overrides.poNumber,
    jobName: overrides.jobName,
    orderNumber: overrides.orderNumber,
  };
}

const sampleRows = [
  row({
    deliveryId: "a",
    vendorInvoiceNumber: "INV-6168008",
    poNumber: "PF-Wausau",
    jobName: "Riverside Medical Center",
    orderNumber: "ORD-100",
  }),
  row({
    deliveryId: "b",
    vendorInvoiceNumber: "2533636",
    poNumber: "2533636",
    jobName: "Oak Street Offices",
    orderNumber: "ORDER-200",
  }),
  row({
    deliveryId: "c",
    vendorInvoiceNumber: "INV-special",
    poNumber: "po-2533636",
    jobName: "Northside (Phase 2)",
    orderNumber: "ORDER-300",
  }),
];

assert.deepEqual(
  filterVendorRunDeliveriesBySearch(sampleRows, ""),
  sampleRows,
  "empty query returns all rows in order",
);
assert.deepEqual(
  filterVendorRunDeliveriesBySearch(sampleRows, "   "),
  sampleRows,
  "whitespace-only query returns all rows",
);

const invoicePartial = filterVendorRunDeliveriesBySearch(sampleRows, "6168");
assert.equal(invoicePartial.length, 1);
assert.equal(invoicePartial[0].deliveryId, "a");

const poWausau = filterVendorRunDeliveriesBySearch(sampleRows, "pf-wau");
assert.equal(poWausau.length, 1);
assert.equal(poWausau[0].poNumber, "PF-Wausau");

const poNumeric = filterVendorRunDeliveriesBySearch(sampleRows, "2533636");
assert.equal(poNumeric.length, 2, "numeric PO matches invoice and PO fields");

const poPrefixed = filterVendorRunDeliveriesBySearch(sampleRows, "po-2533636");
assert.equal(poPrefixed.length, 1);
assert.equal(poPrefixed[0].deliveryId, "c");

const jobPartial = filterVendorRunDeliveriesBySearch(sampleRows, "oak street");
assert.equal(jobPartial.length, 1);
assert.equal(jobPartial[0].jobName, "Oak Street Offices");

const caseInsensitive = filterVendorRunDeliveriesBySearch(
  sampleRows,
  "RIVERSIDE",
);
assert.equal(caseInsensitive.length, 1);

const specialChars = filterVendorRunDeliveriesBySearch(sampleRows, "(phase");
assert.equal(specialChars.length, 1);
assert.equal(specialChars[0].deliveryId, "c");

const orderOptional = filterVendorRunDeliveriesBySearch(sampleRows, "ord-100");
assert.equal(orderOptional.length, 1);

const noMatch = filterVendorRunDeliveriesBySearch(sampleRows, "zzznomatch");
assert.equal(noMatch.length, 0);

const regexLiteral = filterVendorRunDeliveriesBySearch(
  [row({ deliveryId: "x", poNumber: "a.b+c" })],
  "a.b+c",
);
assert.equal(regexLiteral.length, 1, "special chars matched literally not as regex");

console.log("PASS: test-vendor-run-list-search (12 cases)");
