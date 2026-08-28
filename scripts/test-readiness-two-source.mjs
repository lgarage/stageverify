/**
 * Unit tests for two-source readiness gate (offline).
 * Run: npm run test:readiness
 */

import {
  computeDeliveryReadiness,
  computeJobReadiness,
  computeStagingAssignmentComplete,
  getShopStagingAssignmentIds,
  isPickupEligible,
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
import {
  buildMaterialIssuesEvidenceSnapshot,
  buildPhysicalDeliveryEvidenceSnapshot,
  buildStagingEvidenceSnapshot,
} from "../src/dispatcher/email/readinessEvidenceSnapshots.ts";

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
      additionalStagingLocationIds: [],
      plannedStagingLocationIds: [],
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
  boOnlyBanner.attentionHeadline === "1 item is still backordered",
  "BO-only headline is a short backorder title",
);
assert(
  boOnlyBanner.whyBullets.length === 1 &&
    /incomplete and the remaining item has not been confirmed/i.test(boOnlyBanner.whyBullets[0]),
  "BO-only Why is one compact backorder reason",
);
assert(
  boOnlyBanner.nextStepBullets.length === 1 &&
    /Follow up with the vendor for an ETA or updated status/i.test(boOnlyBanner.nextStepBullets[0]),
  "BO-only Next Step is vendor follow-up",
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

// Planned-only staging (Invoice Review Assign Location) counts as assigned for readiness
const plannedOnlyDelivery = {
  ...baseDelivery,
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: ["loc-g12"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "arrived",
};

assert(
  computeStagingAssignmentComplete(plannedOnlyDelivery, completeItems),
  "Invoice Review planned loc-g12 only → stagingAssignmentComplete true",
);

const plannedOnlyReadiness = computeDeliveryReadiness(
  plannedOnlyDelivery,
  completeItems,
);
assert(
  plannedOnlyReadiness.readyForPickup,
  "fully delivered + planned loc-g12 only → readyForPickup true",
);
assert(
  deliveryReadinessDisplayLabel(
    plannedOnlyDelivery,
    plannedOnlyReadiness,
    completeItems,
  ) === "Staged — Ready for Pickup",
  "fully delivered + planned loc-g12 → Staged — Ready for Pickup label",
);
const plannedOnlyBanner = buildDrawerActionBannerContent(
  plannedOnlyDelivery,
  completeItems,
  [],
);
assert(
  plannedOnlyBanner.bannerMode === "all_clear",
  "fully delivered + planned loc-g12 → banner all_clear (not staging missing)",
);
assert(
  !plannedOnlyBanner.whyBullets.some((b) => /staging location/i.test(b)),
  "fully delivered + planned loc-g12 → no staging location missing copy",
);

// No staging at all (cleared primary, additional, and planned)
const noStagingDelivery = {
  ...baseDelivery,
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: [],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "arrived",
};
const noStagingReadiness = computeDeliveryReadiness(
  noStagingDelivery,
  completeItems,
);
assert(
  !noStagingReadiness.readyForPickup,
  "fully delivered + no staging fields → not readyForPickup",
);
const noStagingBanner = buildDrawerActionBannerContent(
  noStagingDelivery,
  completeItems,
  [],
);
assert(
  noStagingBanner.bannerMode === "attention_required",
  "fully delivered + no staging → attention banner",
);
assert(
  noStagingBanner.attentionHeadline === "Staging location missing",
  "fully delivered + no staging → Staging location missing headline",
);

// 6167419-shaped: 3 items all received, vendor complete, physical confirmed, planned G12 only
const fixture6167419Items = [
  {
    id: "item-6167419-1",
    deliveryOrderId: "delivery-6167419",
    description: "TH8320R1003/U THERMOSTAT",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "item-6167419-2",
    deliveryOrderId: "delivery-6167419",
    description: "4050-08 SEALANT",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "item-6167419-3",
    deliveryOrderId: "delivery-6167419",
    description: "TEST-001 FILTER DRIER",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
];
const fixture6167419Delivery = {
  ...baseDelivery,
  id: "delivery-6167419",
  orderNumber: "6167419",
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: ["loc-g12"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
  openBlockingIssueCount: 0,
};
const fixture6167419Readiness = computeDeliveryReadiness(
  fixture6167419Delivery,
  fixture6167419Items,
);
assert(
  fixture6167419Readiness.readyForPickup,
  "6167419-shaped fixture → readyForPickup true",
);
assert(
  deliveryReadinessDisplayLabel(
    fixture6167419Delivery,
    fixture6167419Readiness,
    fixture6167419Items,
  ) === "Staged — Ready for Pickup",
  "6167419-shaped fixture → Staged — Ready for Pickup label",
);
const fixture6167419Banner = buildDrawerActionBannerContent(
  fixture6167419Delivery,
  fixture6167419Items,
  [],
);
assert(
  fixture6167419Banner.bannerMode === "all_clear",
  "6167419-shaped fixture → banner all_clear",
);
assert(
  fixture6167419Banner.attentionHeadline !== "Staging location missing",
  "6167419-shaped fixture → no Staging location missing headline",
);

// 6168008-shaped: email review + 1 backordered + 1 delivered + planned G1 + vendor complete
const fixture6168008Items = [
  {
    id: "item-6168008-delivered",
    deliveryOrderId: "delivery-6168008",
    description: "Delivered part",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
  {
    id: "item-6168008-bo",
    deliveryOrderId: "delivery-6168008",
    description: "Filter Drier Biflo",
    qtyOrdered: 5,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 5,
    status: "backordered",
  },
];
const fixture6168008Delivery = {
  ...baseDelivery,
  id: "delivery-6168008",
  orderNumber: "6168008",
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: ["loc-g1"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
};
const fixture6168008Banner = buildDrawerActionBannerContent(
  fixture6168008Delivery,
  fixture6168008Items,
  [],
  {
    emailReviewRequired: true,
    vendorPhone: "555-0101",
    vendorEmail: "vendor@example.com",
  },
);
assert(
  fixture6168008Banner.bannerMode === "attention_required",
  "6168008-shaped fixture → attention banner",
);
assert(
  fixture6168008Banner.attentionHeadline === "1 item is still backordered",
  "6168008-shaped fixture → backorder headline beats email review",
);
assert(
  fixture6168008Banner.whyBullets.length === 1,
  "6168008-shaped fixture → single Why (operational only, no email prose)",
);
assert(
  !fixture6168008Banner.whyBullets.some((b) => /vendor email proposal/i.test(b)),
  "6168008-shaped fixture → why excludes email review prose",
);
assert(
  fixture6168008Banner.nextStepBullets.length === 1,
  "6168008-shaped fixture → single Next Step",
);
assert(
  /incomplete and the remaining item has not been confirmed/i.test(
    fixture6168008Banner.whyBullets[0],
  ),
  "6168008-shaped fixture → why is backorder incomplete remaining item",
);
assert(
  /follow up with the vendor for an ETA or updated status/i.test(
    fixture6168008Banner.nextStepBullets[0],
  ),
  "6168008-shaped fixture → next is vendor ETA follow-up",
);
assert(
  fixture6168008Banner.showReviewVendorEmail === true,
  "6168008-shaped fixture → Review Vendor Email still available",
);
assert(
  fixture6168008Banner.showEmailVendor === true &&
    fixture6168008Banner.showCallVendor === true,
  "6168008-shaped fixture → Email/Call vendor when contact info set",
);
assert(
  countOpenBlockingIssues(fixture6168008Delivery, []) === 0,
  "6168008-shaped fixture → no open blocking material issues",
);

const stagingLocationsFixture = [
  { id: "loc-g1", code: "G1", label: "G1", zoneId: "zone-1", active: true },
];
const staging6168008Snapshot = buildStagingEvidenceSnapshot({
  delivery: fixture6168008Delivery,
  stagingLocation: null,
  stagingLocations: stagingLocationsFixture,
});
assert(
  staging6168008Snapshot.label === "Planned at G1",
  "6168008-shaped staging snapshot → Planned at G1",
);
const material6168008Snapshot = buildMaterialIssuesEvidenceSnapshot({
  materialIssues: [],
  itemConflicts: fixture6168008Items.filter((item) => item.qtyBackordered > 0),
});
assert(
  material6168008Snapshot.label === "1 backordered item",
  "6168008-shaped material snapshot → 1 backordered item",
);
const physical6168008Snapshot = buildPhysicalDeliveryEvidenceSnapshot({
  physicalDropoffComplete: false,
  vendorPhysicalDropoffConfirmed: true,
  itemConflicts: fixture6168008Items.filter((item) => item.qtyBackordered > 0),
});
assert(
  physical6168008Snapshot.label === "Vendor Marked Delivered — incomplete",
  "6168008-shaped physical snapshot → Vendor Marked Delivered — incomplete",
);

// Pickup eligibility: computed-ready + persisted partial (6167419-shaped)
const inv6170797Items = [
  {
    id: "item-inv-1",
    deliveryOrderId: "delivery-inv-6170797",
    description: "Fully received line",
    qtyOrdered: 1,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "received",
  },
];
const inv6170797Delivery = {
  ...baseDelivery,
  id: "delivery-inv-6170797",
  orderNumber: "INV-6170797",
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: ["loc-g6"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
};
assert(
  isPickupEligible(inv6170797Delivery, inv6170797Items).eligible,
  "INV-6170797-shaped: persisted partial + planned G6 + fully delivered → pickup eligible",
);
assert(
  getShopStagingAssignmentIds(inv6170797Delivery).includes("loc-g6"),
  "getShopStagingAssignmentIds includes planned loc-g6",
);

// Planned-only without physical dropoff → NOT pickup eligible
const plannedOnlyNoPhysicalItems = [
  {
    id: "item-planned-only",
    deliveryOrderId: "delivery-planned-only",
    description: "Never received",
    qtyOrdered: 3,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "missing",
  },
];
const plannedOnlyNoPhysicalDelivery = {
  ...baseDelivery,
  id: "delivery-planned-only",
  stagingLocationId: "",
  additionalStagingLocationIds: [],
  plannedStagingLocationIds: ["loc-g6"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: false,
  status: "arrived",
};
assert(
  !isPickupEligible(plannedOnlyNoPhysicalDelivery, plannedOnlyNoPhysicalItems)
    .eligible,
  "planned-only without physical dropoff → pickup ineligible",
);

// True partial 1 of 3 → NOT pickup eligible
const truePartialItems = [
  {
    id: "item-partial-1",
    deliveryOrderId: "delivery-true-partial",
    description: "One of three",
    qtyOrdered: 3,
    qtyReceived: 1,
    qtyMissing: 2,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
  },
];
const truePartialDelivery = {
  ...baseDelivery,
  id: "delivery-true-partial",
  plannedStagingLocationIds: ["loc-g6"],
  vendorOrderComplete: true,
  vendorPhysicalDropoffConfirmed: true,
  status: "partial",
};
assert(
  !isPickupEligible(truePartialDelivery, truePartialItems).eligible,
  "true partial 1 of 3 stays pickup ineligible",
);

// Dispatcher display still Ready for 6167419-shaped fixture
const display6167419 = computeDeliveryDisplayState(
  fixture6167419Delivery,
  fixture6167419Items,
  [],
);
assert(
  display6167419.statusDisplayLabel === "Staged — Ready for Pickup",
  "6167419-shaped computeDeliveryDisplayState still Ready",
);

if (failures.length) {
  console.error("FAIL readiness tests:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log("PASS readiness two-source tests");
