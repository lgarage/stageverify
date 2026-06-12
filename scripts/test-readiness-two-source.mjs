/**
 * Unit tests for two-source readiness gate (offline).
 * Run: npm run test:readiness
 */

import {
  computeDeliveryReadiness,
  computeJobReadiness,
} from "../src/dispatcher/readiness.ts";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const baseDelivery = {
  id: "del-1",
  orderNumber: "ORD-1007",
  jobId: "job-261042",
  vendorId: "vendor-johnstone",
  purchaseOrderId: "po-johnstone-45821",
  deliveryDate: "2026-06-12",
  stagingLocationId: "loc-g2",
  additionalStagingLocationIds: ["loc-s1a"],
  status: "partial",
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

const completeItems = [
  {
    id: "i1",
    deliveryOrderId: "del-1",
    description: "Coil",
    qtyOrdered: 2,
    qtyReceived: 2,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "i2",
    deliveryOrderId: "del-1",
    description: "Line set",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
];

assert(
  !computeDeliveryReadiness(
    { ...baseDelivery, vendorOrderComplete: false },
    completeItems,
  ).readyForPickup,
  "physical only without vendor complete",
);

assert(
  !computeDeliveryReadiness(
    { ...baseDelivery, vendorOrderComplete: true },
    [{ ...completeItems[0], qtyReceived: 0, qtyMissing: 2, status: "missing" }],
  ).readyForPickup,
  "vendor complete without physical drop-off",
);

assert(
  !computeDeliveryReadiness(
    {
      ...baseDelivery,
      vendorOrderComplete: true,
      stagingLocationId: "",
    },
    completeItems,
  ).readyForPickup,
  "complete drop-off without staging location",
);

assert(
  computeDeliveryReadiness(
    { ...baseDelivery, vendorOrderComplete: true },
    completeItems,
  ).readyForPickup,
  "both sources ready",
);

assert(
  !computeDeliveryReadiness(
    { ...baseDelivery, vendorOrderComplete: true },
    [{ ...completeItems[0], qtyReceived: 1, qtyMissing: 1, status: "partial" }],
  ).readyForPickup,
  "vendor complete with shortage",
);

const itemsByDelivery = new Map([
  ["del-johnstone", completeItems],
  [
    "del-first",
    [
      {
        id: "i3",
        deliveryOrderId: "del-first",
        description: "Filter",
        qtyOrdered: 10,
        qtyReceived: 8,
        qtyMissing: 2,
        qtyDamaged: 0,
        qtyBackordered: 0,
        status: "partial",
      },
    ],
  ],
]);

const jobResult = computeJobReadiness(
  "job-261042",
  [
    { ...baseDelivery, id: "del-johnstone", vendorOrderComplete: true },
    {
      ...baseDelivery,
      id: "del-first",
      vendorId: "vendor-first",
      purchaseOrderId: "po-first-45836",
      vendorOrderComplete: false,
    },
  ],
  [
    {
      id: "po-johnstone-45821",
      poNumber: "PO-45821",
      jobId: "job-261042",
      vendorId: "vendor-johnstone",
      status: "open",
    },
    {
      id: "po-first-45836",
      poNumber: "PO-45836",
      jobId: "job-261042",
      vendorId: "vendor-first",
      status: "open",
    },
  ],
  itemsByDelivery,
);

assert(!jobResult.allReadyForPickup, "job not fully ready with one partial PO");
assert(
  jobResult.poResults.find((p) => p.poId === "po-johnstone-45821")?.readyForPickup,
  "johnstone PO ready alone",
);

if (failures.length) {
  console.error("FAIL readiness tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS readiness two-source tests");
