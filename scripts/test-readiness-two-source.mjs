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
import {
  deliveryReadinessDisplayLabel,
  UNPLANNED_STATUS_LABEL,
} from "../src/dispatcher/jobReadinessDisplay.ts";

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
  readyDisplay.statusDisplayLabel === "Staged — Ready for Pickup",
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
  ord005Display.statusDisplayLabel === "Assigned / Planned",
  "ORD-005 list/drawer label Assigned / Planned when 0 received",
);
assert(
  ord005Panel.itemsReceivedCount === 0 && ord005Panel.itemsTotalCount === 9,
  "ORD-005 issue summary 0 of 9 items received",
);
assert(
  deliveryReadinessDisplayLabel(ord005Delivery, ord005Readiness, ord005Items) ===
    "Assigned / Planned",
  "ORD-005 direct label Assigned / Planned",
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

const unplannedZeroReceived = {
  ...ord005Delivery,
  unplanned: true,
  reviewFlag: {
    flagged: true,
    reason: "Unplanned delivery received — needs job/PO match",
    flaggedBy: "vendor",
    flaggedAt: "2026-06-02T12:00:00Z",
  },
};
const unplannedReadiness = computeDeliveryReadiness(
  unplannedZeroReceived,
  ord005Items,
);
assert(
  deliveryReadinessDisplayLabel(
    unplannedZeroReceived,
    unplannedReadiness,
    ord005Items,
  ) === UNPLANNED_STATUS_LABEL,
  "unplanned pending 0-received label is Unplanned not Assigned / Planned",
);
assert(
  computeDeliveryDisplayState(unplannedZeroReceived, ord005Items, [])
    .statusDisplayLabel === UNPLANNED_STATUS_LABEL,
  "unplanned shell display state uses Unplanned primary label",
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
  ) === "Assigned / Planned",
  "arrived with 0 received is Assigned / Planned not Partial",
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

// Attention banner: list missing items only — not backorder prose (Order Summary shows BO)
const missingPlusBoDelivery = {
  ...baseDelivery,
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
};
const missingPlusBoItems = [
  {
    ...completeItems[0],
    id: "item-missing-banner",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 2,
    qtyBackordered: 0,
    status: "missing",
    description: "MISSING WIDGET",
  },
  {
    ...completeItems[1],
    id: "item-bo-banner",
    qtyOrdered: 3,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyBackordered: 3,
    status: "backordered",
    description: "BO WIDGET",
  },
];
const missingPlusBoBanner = buildDrawerActionBannerContent(
  missingPlusBoDelivery,
  missingPlusBoItems,
  [],
  { vendorPhone: "555-0101", vendorEmail: "vendor@example.com" },
);
assert(
  missingPlusBoBanner.bannerMode === "attention_required",
  "missing+BO delivery shows attention banner",
);
assert(
  /still need attention/i.test(missingPlusBoBanner.attentionHeadline),
  "missing+BO headline uses mixed attention summary",
);
assert(
  missingPlusBoBanner.whyBullets.length === 1 &&
    /still not delivered or backordered/i.test(missingPlusBoBanner.whyBullets[0]),
  "banner Why is one compact mixed-item reason",
);
assert(
  !missingPlusBoBanner.whyBullets.some((b) => /BO WIDGET|on backorder/i.test(b)),
  "banner Why does not list backordered item (Order Summary owns BO)",
);
assert(
  !missingPlusBoBanner.whyBullets.some((b) =>
    /One or more items are on backorder|Vendor reported delivery/i.test(b),
  ),
  "banner Why omits backorder + vendor-mismatch prose when items are summary-only",
);
assert(
  missingPlusBoBanner.nextStepBullets.length === 1 &&
    /Review the incomplete items/i.test(missingPlusBoBanner.nextStepBullets[0]),
  "banner Next Step is one compact review action",
);

const boOnlyDelivery = {
  ...baseDelivery,
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
};
const boOnlyItems = [
  {
    ...completeItems[0],
    id: "item-bo-only",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyBackordered: 2,
    status: "backordered",
    description: "BO ONLY PART",
  },
];
const boOnlyBanner = buildDrawerActionBannerContent(
  boOnlyDelivery,
  boOnlyItems,
  [],
  { vendorPhone: "555-0101", vendorEmail: "vendor@example.com" },
);
assert(
  boOnlyBanner.bannerMode === "attention_required",
  "BO-only delivery keeps attention banner mode",
);
assert(
  boOnlyBanner.attentionHeadline === "1 item backordered",
  "BO-only headline is a short backorder title",
);
assert(
  boOnlyBanner.whyBullets.length === 1 &&
    /still on backorder/i.test(boOnlyBanner.whyBullets[0]),
  "BO-only Why is one compact backorder reason",
);
assert(
  boOnlyBanner.nextStepBullets.length === 1 &&
    /Review the incomplete items/i.test(boOnlyBanner.nextStepBullets[0]),
  "BO-only Next Step is one compact review action",
);
assert(
  boOnlyBanner.showCallVendor === true && boOnlyBanner.showEmailVendor === true,
  "BO-only still offers Call/Email vendor",
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

const stagingBanner = buildDrawerActionBannerContent(
  {
    ...baseDelivery,
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    status: "arrived",
  },
  completeItems,
  [],
);
assert(
  stagingBanner.bannerMode === "attention_required",
  "staging-missing still triggers attention",
);
assert(
  stagingBanner.attentionHeadline === "Staging location missing",
  "staging-missing uses short title",
);
assert(
  stagingBanner.whyBullets.length === 1 &&
    stagingBanner.whyBullets[0] === "Received material has no staging location.",
  "staging-missing Why is one short sentence",
);
assert(
  stagingBanner.nextStepBullets.length === 1 &&
    stagingBanner.nextStepBullets[0] === "Assign a staging location.",
  "staging-missing Next Step is the assign action",
);

const physicalBanner = buildDrawerActionBannerContent(
  {
    ...baseDelivery,
    vendorOrderComplete: false,
    vendorPhysicalDropoffConfirmed: false,
    status: "arrived",
  },
  completeItems,
  [],
  {},
  { vendorDeliveryMode: "exception_only" },
);
assert(
  physicalBanner.bannerMode === "attention_required",
  "physical-incomplete still triggers attention",
);
assert(
  physicalBanner.attentionHeadline === "Physical delivery incomplete",
  "overlapping vendor+physical reasons collapse to physical title",
);
assert(
  physicalBanner.whyBullets.length === 1 &&
    physicalBanner.whyBullets[0] === "Vendor drop-off has not been confirmed.",
  "physical Why does not repeat vendor-order sentence",
);
assert(
  physicalBanner.nextStepBullets.length === 1 &&
    physicalBanner.nextStepBullets[0] === "Confirm the physical delivery.",
  "physical Next Step is one action",
);

const materialBanner = buildDrawerActionBannerContent(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    status: "ready_for_pickup",
  },
  completeItems,
  liveOpenIssue,
);
assert(
  materialBanner.bannerMode === "attention_required",
  "blocking material issue still triggers attention",
);
assert(
  materialBanner.attentionHeadline === "Material issue open",
  "material issue uses short title",
);
assert(
  materialBanner.whyBullets.length === 1 &&
    /blocking material issue/i.test(materialBanner.whyBullets[0]),
  "material issue Why stays accurate without dumping description twice",
);
assert(
  materialBanner.nextStepBullets[0] === "Review and resolve the issue.",
  "material issue Next Step points at resolve",
);
assert(
  materialBanner.showReviewIssues === true,
  "material issue keeps Review Issues action",
);

assert(
  partialBanner.attentionHeadline === "Partial delivery",
  "partial delivery uses short title",
);
assert(
  partialBanner.whyBullets.length === 1 &&
    /still not delivered or backordered/i.test(partialBanner.whyBullets[0]),
  "partial Why is compact and does not claim full delivery",
);
assert(
  partialBanner.nextStepBullets[0] === "Review the incomplete items.",
  "partial Next Step is review incomplete items",
);

const emailStagingBanner = buildDrawerActionBannerContent(
  {
    ...baseDelivery,
    stagingLocationId: "",
    additionalStagingLocationIds: [],
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    status: "arrived",
  },
  completeItems,
  liveOpenIssue,
  { emailReviewRequired: true, vendorPhone: "555-0101", vendorEmail: "v@example.com" },
);
assert(
  emailStagingBanner.attentionHeadline === "Material issue open",
  "independent blockers keep the most important title first",
);
assert(
  emailStagingBanner.whyBullets.length === 2,
  "two independent blockers keep two compact Why lines",
);
assert(
  emailStagingBanner.showReviewVendorEmail === true,
  "Review Vendor Email action remains available",
);
assert(
  emailStagingBanner.showReviewIssues === true,
  "Review Issues remains available with a blocking issue",
);

const readyBanner = buildDrawerActionBannerContent(
  {
    ...baseDelivery,
    vendorOrderComplete: true,
    vendorPhysicalDropoffConfirmed: true,
    status: "ready_for_pickup",
  },
  completeItems,
  [],
);
assert(
  readyBanner.bannerMode === "all_clear",
  "no-issue ready delivery does not create an attention alert",
);
assert(
  readyBanner.whyBullets.length === 0 && readyBanner.nextStepBullets.length === 0,
  "All Clear has no Why/Next attention copy",
);

if (failures.length) {
  console.error("FAIL readiness tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS readiness two-source tests");
