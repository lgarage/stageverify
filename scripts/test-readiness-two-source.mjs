/**
 * Unit tests for two-source readiness gate (offline).
 * Run: npm run test:readiness
 */

import {
  computeDeliveryReadiness,
  computeJobReadiness,
} from "../src/dispatcher/readiness.ts";
import {
  computeDeliveryDisplayState,
  countOpenBlockingIssues,
  buildIssueSummaryPanelData,
  sumItemQtyOrdered,
  sumItemQtyReceived,
} from "../src/dispatcher/deliveryDisplayHelpers.ts";
import { deliveryReadinessDisplayLabel } from "../src/dispatcher/jobReadinessDisplay.ts";

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

const readyDelivery = {
  ...baseDelivery,
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "arrived",
  readinessBlockReasons: ["vendor_order_incomplete", "physical_dropoff_incomplete"],
  openBlockingIssueCount: 1,
};
const readyDisplay = computeDeliveryDisplayState(readyDelivery, completeItems, []);
assert(
  readyDisplay.statusDisplayLabel === "Ready for Pickup",
  "list label ready when evidence complete despite stale persisted fields",
);
assert(readyDisplay.issueSummary === "", "no issue summary when ready");
assert(
  countOpenBlockingIssues(readyDelivery) === 1,
  "persisted blocking count when materialIssues unavailable",
);
assert(
  countOpenBlockingIssues(readyDelivery, [
    {
      id: "resolved-1",
      deliveryOrderId: "del-1",
      jobId: "job-261042",
      type: "missing",
      status: "resolved",
      reportedBy: "vendor",
      blocking: true,
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
    },
  ]) === 0,
  "live materialIssues override stale openBlockingIssueCount",
);

const ord005Items = [
  {
    id: "item-demo-v1-1",
    deliveryOrderId: "delivery-demo-vendor-1",
    description: "Air handler 3-ton horizontal",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  {
    id: "item-demo-v1-2",
    deliveryOrderId: "delivery-demo-vendor-1",
    description: "Filter rack 16x25 MERV 11",
    qtyOrdered: 6,
    qtyReceived: 0,
    qtyMissing: 6,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  {
    id: "item-demo-v1-3",
    deliveryOrderId: "delivery-demo-vendor-1",
    description: "BAS controller module",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 2,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
];

const ord005Delivery = {
  id: "delivery-demo-vendor-1",
  orderNumber: "ORD-005",
  jobId: "job-1",
  vendorId: "vendor-1",
  purchaseOrderId: "po-demo-vendor-1",
  deliveryDate: "2026-06-02",
  status: "pending",
  createdAt: "2026-06-02T12:00:00Z",
  updatedAt: "2026-06-02T12:00:00Z",
};

const ord005Readiness = computeDeliveryReadiness(ord005Delivery, ord005Items);
const ord005Display = computeDeliveryDisplayState(
  ord005Delivery,
  ord005Items,
  [],
);
const ord005Panel = buildIssueSummaryPanelData(ord005Delivery, ord005Items, []);

assert(
  sumItemQtyOrdered(ord005Items) === 9,
  "ORD-005 unit total is 9 ordered",
);
assert(
  sumItemQtyReceived(ord005Items) === 0,
  "ORD-005 unit total is 0 received",
);
assert(
  ord005Display.statusDisplayLabel === "Pending Delivery",
  "ORD-005 list/drawer label Pending Delivery when 0 received",
);
assert(
  ord005Panel.itemsReceivedCount === 0 && ord005Panel.itemsTotalCount === 9,
  "ORD-005 issue summary 0 of 9 items received",
);
assert(
  deliveryReadinessDisplayLabel(ord005Delivery, ord005Readiness, ord005Items) ===
    "Pending Delivery",
  "ORD-005 direct label Pending Delivery",
);

const arrivedZeroReceived = {
  ...ord005Delivery,
  status: "arrived",
};
const arrivedReadiness = computeDeliveryReadiness(
  arrivedZeroReceived,
  ord005Items,
);
assert(
  deliveryReadinessDisplayLabel(
    arrivedZeroReceived,
    arrivedReadiness,
    ord005Items,
  ) === "Pending Delivery",
  "arrived with 0 received is Pending Delivery not Partial",
);

const partialItems = [
  {
    id: "item-7",
    deliveryOrderId: "delivery-3",
    description: "Pump circulator 5HP",
    qtyOrdered: 2,
    qtyReceived: 1,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
  },
  {
    id: "item-6",
    deliveryOrderId: "delivery-3",
    description: "Chiller 50-ton modular",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
];

const partialDelivery = {
  ...baseDelivery,
  id: "delivery-3",
  status: "partial",
};
const partialReadiness = computeDeliveryReadiness(partialDelivery, partialItems);
const partialDisplay = computeDeliveryDisplayState(
  partialDelivery,
  partialItems,
  [],
);

assert(
  deliveryReadinessDisplayLabel(
    partialDelivery,
    partialReadiness,
    partialItems,
  ) === "Partial",
  "Partial only when received > 0 and < ordered",
);
assert(
  partialDisplay.statusDisplayLabel === "Partial",
  "list and drawer Partial label agree for partial qty",
);
assert(
  buildIssueSummaryPanelData(partialDelivery, partialItems, [])
    .itemsReceivedCount === 2 &&
    buildIssueSummaryPanelData(partialDelivery, partialItems, [])
      .itemsTotalCount === 3,
  "partial delivery unit counts 2 of 3",
);

if (failures.length) {
  console.error("FAIL readiness tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS readiness two-source tests");
