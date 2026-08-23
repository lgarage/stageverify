import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const helperSource = readFileSync(
  resolve(process.cwd(), "src/dispatcher/vendorJobCardStatus.ts"),
  "utf8",
);
const helperJavaScript = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(helperJavaScript).toString("base64")}`
);
const {
  deriveVendorOrderFulfillmentLabel,
  deriveVendorItemLineStatus,
  vendorItemsHaveFulfillmentQty,
  vendorFulfillmentTone,
} = helperModule;

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: true,
    items: [
      { qtyOrdered: 6, qtyReceived: 6, qtyBackordered: 0 },
      { qtyOrdered: 5, qtyReceived: 5, qtyBackordered: 0 },
    ],
  }),
  "Delivered",
  "all required delivered => Delivered",
);

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: true,
    items: [
      { qtyOrdered: 6, qtyReceived: 6, qtyBackordered: 0 },
      { qtyOrdered: 5, qtyReceived: 0, qtyBackordered: 5, status: "backordered" },
    ],
  }),
  "Partial",
  "physical drop-off + backorder => Partial",
);

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: true,
    items: [
      { qtyOrdered: 6, qtyReceived: 6, qtyBackordered: 0 },
      { qtyOrdered: 5, qtyReceived: 0, qtyBackordered: 0 },
    ],
  }),
  "Partial",
  "physical drop-off + Not Delivered => Partial",
);

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: true,
    items: [{ qtyOrdered: 4 }],
  }),
  "Delivered",
  "legacy DTO without qtyReceived still uses physical drop-off",
);

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: true,
    deliveryStatus: "partial",
    items: [{ qtyOrdered: 4 }],
  }),
  "Partial",
  "persisted delivery.status partial wins over legacy drop-off Delivered",
);

assert.equal(
  deriveVendorOrderFulfillmentLabel({
    vendorPhysicalDropoffConfirmed: false,
    items: [{ qtyOrdered: 2, qtyReceived: 0, qtyBackordered: 0 }],
  }),
  "Incomplete",
  "no received qty and no drop-off => Incomplete",
);

assert.equal(
  deriveVendorItemLineStatus({
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyBackordered: 2,
  }),
  "Backordered",
);
assert.equal(
  deriveVendorItemLineStatus({
    qtyOrdered: 5,
    qtyReceived: 0,
    qtyBackordered: 0,
  }),
  "Not Delivered",
);
assert.equal(
  deriveVendorItemLineStatus({
    qtyOrdered: 4,
    qtyReceived: 4,
    qtyBackordered: 0,
  }),
  "Delivered",
);
assert.equal(
  deriveVendorItemLineStatus({
    qtyOrdered: 4,
    qtyReceived: 2,
    qtyBackordered: 0,
  }),
  "Partial Delivery",
);

assert.equal(
  vendorItemsHaveFulfillmentQty([{ qtyOrdered: 1 }]),
  false,
);
assert.equal(
  vendorItemsHaveFulfillmentQty([{ qtyOrdered: 1, qtyReceived: 0 }]),
  true,
);
assert.equal(vendorFulfillmentTone("Partial"), "partial");
assert.equal(vendorFulfillmentTone("Delivered"), "delivered");

console.log("PASS: test-vendor-job-card-status (12 cases)");
