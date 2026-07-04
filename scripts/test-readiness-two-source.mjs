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
  buildDrawerActionBannerContent,
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
    description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
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
    description: "4050-08 SEALANT REFRIGERATIO EASYSEAL",
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
    description: "TEST-001 FILTER DRIER",
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
assert(
  ord005Panel.openIssuesCount === 0,
  "ORD-005 pending-not-delivered lines are not counted as open issues",
);
assert(
  ord005Panel.issueRows.length === 3,
  "ORD-005 item table still lists not-delivered rows",
);
const ord005Banner = buildDrawerActionBannerContent(
  ord005Delivery,
  ord005Items,
  [],
);
assert(
  ord005Banner.bannerMode === "calm_waiting",
  "ORD-005 drawer banner is calm waiting (not urgent)",
);
assert(
  ord005Banner.showCallVendor === false && ord005Banner.showEmailVendor === false,
  "ORD-005 does not promote vendor contact for normal pending",
);

function zeroQtyItemsFromOrd005() {
  return ord005Items.map((item) => ({ ...item }));
}

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
assert(
  arrivedReadiness.deliveryStatus !== "partial",
  "arrived with 0 received persisted status is not partial",
);
assert(
  arrivedReadiness.deliveryStatus === "arrived",
  "arrived with 0 received persisted status stays arrived",
);

// vendorOnly + qty=0 → not partial (one-source evidence, zero qty)
const vendorOnlyZero = computeDeliveryReadiness(
  {
    ...baseDelivery,
    status: "arrived",
    vendorOrderComplete: true,
    stagingLocationId: "loc-g2",
  },
  zeroQtyItemsFromOrd005(),
);
assert(
  vendorOnlyZero.deliveryStatus !== "partial",
  "vendorOnly with qty=0 is not partial",
);
assert(
  vendorOnlyZero.deliveryStatus === "arrived",
  "vendorOnly with qty=0 on arrived stays arrived",
);

// physicalOnly + qty=0 (exception_only DELIVERED) → not partial
const physicalOnlyZero = computeDeliveryReadiness(
  {
    ...baseDelivery,
    status: "arrived",
    vendorPhysicalDropoffConfirmed: true,
    vendorOrderComplete: false,
    stagingLocationId: "loc-g2",
  },
  zeroQtyItemsFromOrd005(),
  { vendorDeliveryMode: "exception_only" },
);
assert(
  physicalOnlyZero.deliveryStatus !== "partial",
  "physicalOnly exception_only with qty=0 is not partial",
);
assert(
  physicalOnlyZero.deliveryStatus === "arrived",
  "physicalOnly exception_only with qty=0 on arrived stays arrived",
);

const partialItems = [
  {
    id: "item-7",
    deliveryOrderId: "delivery-3",
    description: "TH8320R1003/U THERMOSTAT PROGRAMMABLE REDLINK",
    qtyOrdered: 3,
    qtyReceived: 2,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
  },
  {
    id: "item-6",
    deliveryOrderId: "delivery-3",
    description: "4050-08 SEALANT REFRIGERATIO EASYSEAL",
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
assert(
  partialReadiness.deliveryStatus === "partial",
  "qty received > 0 yields partial persisted status",
);
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
    .itemsReceivedCount === 3 &&
    buildIssueSummaryPanelData(partialDelivery, partialItems, [])
      .itemsTotalCount === 4,
  "partial delivery unit counts 3 of 4",
);
const partialBanner = buildDrawerActionBannerContent(
  partialDelivery,
  partialItems,
  [],
);
assert(
  partialBanner.bannerMode === "attention_required",
  "partial delivery with outstanding qty shows attention banner",
);
assert(
  buildIssueSummaryPanelData(partialDelivery, partialItems, []).openIssuesCount === 1,
  "partial outstanding row counts as one exception issue",
);

const staleOpenIssueDelivery = {
  ...baseDelivery,
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "ready_for_pickup",
  openIssueCount: 0,
};
const liveOpenIssue = [
  {
    id: "issue-live",
    deliveryOrderId: "del-1",
    jobId: "job-261042",
    type: "missing",
    status: "open",
    reportedBy: "tech",
    blocking: true,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  },
];
const issueReadiness = computeDeliveryReadiness(
  staleOpenIssueDelivery,
  completeItems,
  { openBlockingIssueCount: 1 },
);
assert(
  deliveryReadinessDisplayLabel(
    staleOpenIssueDelivery,
    issueReadiness,
    completeItems,
    liveOpenIssue,
  ) === "Issue / Review Required",
  "live materialIssues override stale openIssueCount=0 for label",
);
assert(
  computeDeliveryDisplayState(
    staleOpenIssueDelivery,
    completeItems,
    liveOpenIssue,
  ).statusDisplayLabel === "Issue / Review Required",
  "computeDeliveryDisplayState passes live issues to label",
);

if (failures.length) {
  console.error("FAIL readiness tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS readiness two-source tests");
