/**
 * Unit tests — invoice shell staging exemption + job name resolution.
 * Usage: node scripts/test-invoice-shell-display.mjs
 */
import {
  buildDeliverToSiteIssueSummary,
  extractDeliverToSiteLabel,
  fulfillmentDisplayLabel,
  isDeliverToSiteConfirmed,
  isInvoiceShellNoShopStaging,
  jobNameFromInvoiceContext,
  resolveDeliveryPoNumber,
  resolveShellDeliveryStatus,
  skipsShopStaging,
} from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";
import {
  buildInvoiceShellPatchDocument,
  buildInvoiceMatchedDeliveryPatchDocument,
  isTerminalPickupShellDelivery,
  shouldPreserveExistingOperationalFulfillment,
} from "../functions/src/invoice/createDeliveryShellFromImport.ts";
import {
  isInvoiceShellNoShopStaging as isInvoiceShellNoShopStagingCf,
  resolveShellDeliveryStatus as resolveShellDeliveryStatusCf,
  skipsShopStaging as skipsShopStagingCf,
} from "../functions/src/invoice/invoiceShellDisplayHelpers.ts";
import { vendorInvoiceImportDisplayLabelForRow } from "../src/dispatcher/invoice/invoiceDisplayHelpers.ts";
import { computeDeliveryReadiness } from "../src/dispatcher/readiness.ts";
import { deliveryReadinessDisplayLabel } from "../src/dispatcher/jobReadinessDisplay.ts";
import {
  buildIssueSummaryPanelData,
  computeDeliveryDisplayState,
  sumEffectiveItemQtyReceived,
  isCompleteOverviewRow,
  rowMatchesOverviewStatusFilter,
  DELIVERY_OVERVIEW_STATUS_ORDER,
  isWillCallPickupStagingListNa,
  isWillCallOverviewRow,
  isDispatcherTableStagingActionRequired,
} from "../src/dispatcher/deliveryDisplayHelpers.ts";

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

assert(
  "DELIVER TO extracted from order notes",
  extractDeliverToSiteLabel(["DELIVER TO: Planet Fitness Hartford"]) ===
    "Planet Fitness Hartford",
);

assert(
  "DELIVER TO joins next line when split (P411190 prod shape)",
  extractDeliverToSiteLabel([
    "****DELIVERY INSTRUCTIONS****",
    "DELIVER TO:Planet Fitness",
    "Hartford",
    "DATE:1/8 or 1/9",
  ]) === "Planet Fitness Hartford",
);

assert(
  "job name prefers DELIVER TO over PO tokens",
  jobNameFromInvoiceContext("blackduck hartfo", [
    "DELIVER TO: Planet Fitness Hartford",
  ]) === "Planet Fitness Hartford",
);

assert(
  "pickup_at_vendor skips shop staging",
  isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: true,
    status: "complete",
  }),
);

const willCallShellDelivery = {
  id: "delivery-willcall-test",
  orderNumber: "WC-1",
  jobId: "job-1",
  vendorId: "v-1",
  vendorName: "Vendor",
  deliveryDate: "2026-01-08",
  status: "complete",
  vendorOrderComplete: true,
  invoiceImportStatus: "pickup_at_vendor",
  createdFromInvoiceImport: true,
};
const willCallItems = [
  {
    id: "item-wc",
    deliveryOrderId: "delivery-willcall-test",
    jobId: "job-1",
    description: "Part",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyBackordered: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
  },
];
assert(
  "will-call shell has empty Issue column when no exception",
  computeDeliveryDisplayState(willCallShellDelivery, willCallItems, [])
    .issueSummary === "",
);

assert(
  "will-call fulfillment uses exact table label",
  fulfillmentDisplayLabel(willCallShellDelivery) ===
    "Will-Call / Pickup @ Vendor",
);

assert(
  "will-call shell staging list column is N/A gate",
  isWillCallPickupStagingListNa(willCallShellDelivery),
);

const willCallReadiness = computeDeliveryReadiness(
  willCallShellDelivery,
  willCallItems,
);
assert(
  "will-call shell status remains workflow-derived (not fulfillment text)",
  deliveryReadinessDisplayLabel(
    willCallShellDelivery,
    willCallReadiness,
    willCallItems,
  ) === "Picked Up",
);

assert(
  "pickup_at_vendor + will_call import maps to ready_for_pickup shell status",
  resolveShellDeliveryStatus("pickup_at_vendor", "will_call_pickup", false) ===
    "ready_for_pickup",
);

assert(
  "FE: pickup_at_vendor + delivery maps to pending shell status",
  resolveShellDeliveryStatus("pickup_at_vendor", "delivery", false) === "pending",
);

assert(
  "FE: pickup_at_vendor + unknown maps to ready_for_pickup shell status",
  resolveShellDeliveryStatus("pickup_at_vendor", "unknown", false) ===
    "ready_for_pickup",
);

assert(
  "CF: pickup_at_vendor + delivery maps to pending shell status",
  resolveShellDeliveryStatusCf("pickup_at_vendor", "delivery", false) === "pending",
);

assert(
  "CF: pickup_at_vendor + will_call maps to ready_for_pickup shell status",
  resolveShellDeliveryStatusCf("pickup_at_vendor", "will_call_pickup", false) ===
    "ready_for_pickup",
);

assert(
  "CF: pickup_at_vendor + unknown maps to ready_for_pickup shell status",
  resolveShellDeliveryStatusCf("pickup_at_vendor", "unknown", false) ===
    "ready_for_pickup",
);

const willCallFulfillmentOnlyDelivery = {
  ...willCallShellDelivery,
  id: "delivery-willcall-fulfillment-only",
  status: "pending",
  invoiceImportStatus: "pending",
  invoiceFulfillmentMethod: "will_call_pickup",
};
const willCallFulfillmentReadiness = computeDeliveryReadiness(
  willCallFulfillmentOnlyDelivery,
  willCallItems,
);
assert(
  "fulfillment-only will_call_pickup primary category is Will-Call / Pickup (not shop Staged)",
  deliveryReadinessDisplayLabel(
    willCallFulfillmentOnlyDelivery,
    willCallFulfillmentReadiness,
    willCallItems,
  ) === "Will-Call / Pickup",
);

const vendorReadyWillCallDelivery = {
  ...willCallFulfillmentOnlyDelivery,
  id: "delivery-willcall-vendor-ready",
  status: "ready_for_pickup",
  invoiceImportStatus: "pickup_at_vendor",
  invoiceFulfillmentMethod: "will_call_pickup",
  vendorOrderComplete: true,
};
const vendorReadyWillCallItems = willCallItems.map((item) => ({
  ...item,
  id: `${item.id}-vr`,
  deliveryOrderId: vendorReadyWillCallDelivery.id,
}));
const vendorReadyWillCallReadiness = computeDeliveryReadiness(
  vendorReadyWillCallDelivery,
  vendorReadyWillCallItems,
);
assert(
  "vendor-ready Will-Call still primary Will-Call / Pickup (not Staged green)",
  deliveryReadinessDisplayLabel(
    vendorReadyWillCallDelivery,
    vendorReadyWillCallReadiness,
    vendorReadyWillCallItems,
  ) === "Will-Call / Pickup",
);
const vendorReadyWillCallRow = {
  status: vendorReadyWillCallDelivery.status,
  statusDisplayLabel: "Will-Call / Pickup",
  fulfillmentDisplayLabel: "Will-Call / Pickup @ Vendor",
  stagingLocationListNotApplicable: true,
};
assert(
  "Will-Call overview row is recognized",
  isWillCallOverviewRow(vendorReadyWillCallRow),
);
assert(
  "Will-Call does not match Staged — Ready for Pickup filter",
  !rowMatchesOverviewStatusFilter(vendorReadyWillCallRow, "ready_for_pickup"),
);

assert(
  "shop fulfillment uses exact table label",
  fulfillmentDisplayLabel({ invoiceFulfillmentMethod: "delivery" }) ===
    "Vendor Drop-Off",
);

const willCallMixedItems = [
  {
    id: "item-wc-bo",
    deliveryOrderId: "delivery-willcall-bo",
    description: "Backordered part",
    qtyOrdered: 2,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 2,
    status: "backordered",
  },
  {
    id: "item-wc-missing",
    deliveryOrderId: "delivery-willcall-bo",
    description: "Not shipped yet",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 1,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
  {
    id: "item-wc-partial",
    deliveryOrderId: "delivery-willcall-bo",
    description: "Partial line",
    qtyOrdered: 4,
    qtyReceived: 1,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "partial",
  },
];
const willCallBoPanel = buildIssueSummaryPanelData(
  {
    ...willCallShellDelivery,
    id: "delivery-willcall-bo",
    invoiceFulfillmentMethod: "will_call_pickup",
  },
  willCallMixedItems,
);
assert(
  "will-call Order Summary keeps Backordered rows only",
  willCallBoPanel.issueRows.length === 1 &&
    willCallBoPanel.issueRows[0].status === "Backordered" &&
    willCallBoPanel.issueRows[0].itemId === "item-wc-bo",
  `rows=${willCallBoPanel.issueRows.map((r) => r.status).join(",")}`,
);

assert(
  "deliver-to-site skips shop staging",
  isInvoiceShellNoShopStaging({
    invoiceDeliverToSite: true,
    invoiceImportStatus: "pending",
    status: "complete",
    createdFromInvoiceImport: true,
  }),
);

assert(
  "normal pending shop delivery still requires staging action path",
  !isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pending",
    status: "pending",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "pickup_at_vendor alone does not skip staging without invoice shell marker",
  !isInvoiceShellNoShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "Branch-B will-call skips shop staging via skipsShopStaging (non-shell)",
  skipsShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "explicit Vendor Drop-Off wins over stale pickup_at_vendor import status",
  !skipsShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    invoiceFulfillmentMethod: "delivery",
    createdFromInvoiceImport: true,
  }) &&
    !isWillCallPickupStagingListNa({
      invoiceImportStatus: "pickup_at_vendor",
      invoiceFulfillmentMethod: "delivery",
    }) &&
    !isInvoiceShellNoShopStaging({
      invoiceImportStatus: "pickup_at_vendor",
      invoiceFulfillmentMethod: "delivery",
      createdFromInvoiceImport: true,
    }),
);

assert(
  "explicit Will-Call still skips shop staging after toggle",
  skipsShopStaging({
    invoiceImportStatus: "pickup_at_vendor",
    invoiceFulfillmentMethod: "will_call_pickup",
    createdFromInvoiceImport: true,
  }) &&
    isWillCallPickupStagingListNa({
      invoiceImportStatus: "pickup_at_vendor",
      invoiceFulfillmentMethod: "will_call_pickup",
    }),
);

assert(
  "Branch-B will_call_pickup skips dispatcher table staging action",
  !isDispatcherTableStagingActionRequired({
    status: "partial",
    invoiceFulfillmentMethod: "will_call_pickup",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "normal shop delivery still flags missing staging in table",
  isDispatcherTableStagingActionRequired({
    invoiceImportStatus: "pending",
    status: "partial",
    createdFromInvoiceImport: false,
  }),
);

assert(
  "canonical shell delivery id exempts staging when deliver-to-site",
  isInvoiceShellNoShopStaging({
    id: "delivery-vii-test-import-1",
    invoiceDeliverToSite: true,
    invoiceImportStatus: "pending",
    status: "complete",
  }),
);

assert(
  "deliver-to-site pending import maps to complete delivery status",
  resolveShellDeliveryStatus("pending", "delivery", true) === "complete",
);

assert(
  "pending + DELIVER TO notes show Deliver to Site label",
  vendorInvoiceImportDisplayLabelForRow("pending", [
    "DELIVER TO: Planet Fitness Hartford",
  ]) === "Deliver to Site",
);

assert(
  "pending without DELIVER TO keeps Pending Delivery label",
  vendorInvoiceImportDisplayLabelForRow("pending", []) === "Pending Delivery",
);

const deliverToSiteReadiness = computeDeliveryReadiness(
  {
    id: "delivery-vii-test",
    orderNumber: "4046362",
    jobId: "job-1",
    vendorId: "v-1",
    vendorName: "Johnstone",
    deliveryDate: "2026-01-08",
    status: "complete",
    vendorOrderComplete: true,
    vendorOrderCompleteSource: "vendor_email",
    invoiceDeliverToSite: true,
    invoiceDeliverToSiteConfirmed: true,
    invoiceImportStatus: "pending",
    createdFromInvoiceImport: true,
  },
  [
    {
      id: "item-1",
      deliveryOrderId: "delivery-vii-test",
      jobId: "job-1",
      description: "Filter",
      qtyOrdered: 4,
      qtyReceived: 0,
      qtyBackordered: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
    },
  ],
);
assert(
  "deliver-to-site shell skips shop physical/staging blockers",
  !deliverToSiteReadiness.evidence.readinessBlockReasons.includes(
    "physical_dropoff_incomplete",
  ) &&
    !deliverToSiteReadiness.evidence.readinessBlockReasons.includes(
      "staging_assignment_incomplete",
    ),
);

assert(
  "deliver-to-site complete shells count as complete status (not staged)",
  deliverToSiteReadiness.deliveryStatus === "complete",
);

const deliverToSiteUnconfirmed = computeDeliveryReadiness(
  {
    id: "delivery-vii-test-unconfirmed",
    orderNumber: "4046362",
    jobId: "job-1",
    vendorId: "v-1",
    vendorName: "Johnstone",
    deliveryDate: "2026-01-08",
    status: "complete",
    vendorOrderComplete: true,
    vendorOrderCompleteSource: "vendor_email",
    invoiceDeliverToSite: true,
    invoiceImportStatus: "pending",
    invoiceDeliverToLabel: "Planet Fitness Hartford",
    createdFromInvoiceImport: true,
  },
  [
    {
      id: "item-1",
      deliveryOrderId: "delivery-vii-test-unconfirmed",
      jobId: "job-1",
      description: "Filter",
      qtyOrdered: 4,
      qtyReceived: 0,
      qtyBackordered: 0,
      qtyMissing: 0,
      qtyDamaged: 0,
    },
  ],
);
assert(
  "deliver-to-site without confirmation stays ready_for_pickup in list counts",
  deliverToSiteUnconfirmed.deliveryStatus === "ready_for_pickup",
);

assert(
  "buildDeliverToSiteIssueSummary pending shows confirm line",
  buildDeliverToSiteIssueSummary({
    invoiceDeliverToSite: true,
    invoiceDeliverToLabel: "Planet Fitness Hartford",
  }) === "Confirm delivery to Planet Fitness Hartford",
);

assert(
  "buildDeliverToSiteIssueSummary confirmed returns empty (no note when delivered)",
  buildDeliverToSiteIssueSummary({
    invoiceDeliverToSite: true,
    invoiceDeliverToLabel: "Planet Fitness Hartford",
    invoiceDeliverToSiteConfirmed: true,
  }) === null,
);

assert(
  "isDeliverToSiteConfirmed requires explicit flag",
  !isDeliverToSiteConfirmed({}) &&
    isDeliverToSiteConfirmed({ invoiceDeliverToSiteConfirmed: true }),
);

assert(
  "resolveDeliveryPoNumber prefers linked PO then invoice customer P/O",
  resolveDeliveryPoNumber("blackduck hartfo", undefined) === "blackduck hartfo" &&
    resolveDeliveryPoNumber("blackduck hartfo", "PO-123") === "PO-123",
);

const deliverToSiteItems = [
  {
    id: "item-1",
    deliveryOrderId: "delivery-vii-test",
    jobId: "job-1",
    description: "Filter A",
    qtyOrdered: 20,
    qtyReceived: 0,
    qtyBackordered: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
  },
  {
    id: "item-2",
    deliveryOrderId: "delivery-vii-test",
    jobId: "job-1",
    description: "Filter B",
    qtyOrdered: 23,
    qtyReceived: 0,
    qtyBackordered: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
  },
];

const deliverToSiteConfirmedDelivery = {
  id: "delivery-vii-test",
  orderNumber: "4046362",
  jobId: "job-1",
  vendorId: "v-1",
  vendorName: "Johnstone",
  deliveryDate: "2026-01-08",
  status: "complete",
  vendorOrderComplete: true,
  vendorOrderCompleteSource: "vendor_email",
  invoiceDeliverToSite: true,
  invoiceDeliverToSiteConfirmed: true,
  invoiceDeliverToLabel: "Planet Fitness Hartford",
  invoiceImportStatus: "pending",
  createdFromInvoiceImport: true,
};

assert(
  "deliver-to-site confirmed display label follows complete workflow",
  deliveryReadinessDisplayLabel(
    deliverToSiteConfirmedDelivery,
    deliverToSiteReadiness,
    deliverToSiteItems,
  ) === "Picked Up",
);

assert(
  "sumEffectiveItemQtyReceived treats confirmed site delivery as full receipt",
  sumEffectiveItemQtyReceived(deliverToSiteConfirmedDelivery, deliverToSiteItems) ===
    43,
);

const confirmedPanel = buildIssueSummaryPanelData(
  deliverToSiteConfirmedDelivery,
  deliverToSiteItems,
);
assert(
  "issue summary panel shows 43 of 43 when site delivery confirmed",
  confirmedPanel.itemsReceivedCount === 43 &&
    confirmedPanel.itemsTotalCount === 43 &&
    confirmedPanel.deliveryStatusLabel === "Picked Up",
);
assert(
  "issue summary panel hides not-delivered rows when site delivery confirmed",
  confirmedPanel.issueRows.length === 0 &&
    confirmedPanel.receivedItems.length === 2,
);

const confirmedDisplay = computeDeliveryDisplayState(
  deliverToSiteConfirmedDelivery,
  deliverToSiteItems,
  [],
  { jobPickupScheduled: true },
);
assert(
  "issue summary column empty when site delivery confirmed (status column shows Picked Up)",
  confirmedDisplay.issueSummary === "",
);
assert(
  "unconfirmed deliver-to-site still shows confirm line in issue summary",
  computeDeliveryDisplayState(
    {
      ...deliverToSiteConfirmedDelivery,
      invoiceDeliverToSiteConfirmed: false,
    },
    deliverToSiteItems,
    [],
    { jobPickupScheduled: true },
  ).issueSummary === "Confirm delivery to Planet Fitness Hartford",
);

const completeListRow = {
  status: "complete",
  statusDisplayLabel: "Complete",
};
assert(
  "complete overview filter matches deliver-to-site and picked-up terminal rows",
  isCompleteOverviewRow(completeListRow) &&
    rowMatchesOverviewStatusFilter(completeListRow, "complete") &&
    !rowMatchesOverviewStatusFilter(completeListRow, "ready_for_pickup"),
);

assert(
  "complete overview filter includes status complete even when label differs",
  rowMatchesOverviewStatusFilter(
    { status: "complete", statusDisplayLabel: "Staged — Ready for Pickup" },
    "complete",
  ),
);

const pickedUpListRow = {
  status: "picked_up",
  statusDisplayLabel: "Complete",
};
assert(
  "picked up overview filter matches via complete chip only",
  isCompleteOverviewRow(pickedUpListRow) &&
    rowMatchesOverviewStatusFilter(pickedUpListRow, "complete") &&
    !rowMatchesOverviewStatusFilter(pickedUpListRow, "ready_for_pickup"),
);

const closedPickedUpDelivery = {
  id: "delivery-closed-pu",
  orderNumber: "6168732",
  jobId: "job-1",
  vendorId: "v-1",
  vendorName: "Johnstone",
  deliveryDate: "2026-01-08",
  status: "pending",
  vendorOrderComplete: true,
  invoiceImportStatus: "closed_picked_up",
  invoiceFulfillmentMethod: "will_call_pickup",
  createdFromInvoiceImport: true,
};
const closedPickedUpItems = [
  {
    id: "item-closed-pu",
    deliveryOrderId: "delivery-closed-pu",
    description: "Filter",
    qtyOrdered: 1,
    qtyReceived: 0,
    qtyMissing: 0,
    qtyDamaged: 0,
    qtyBackordered: 0,
    status: "pending",
  },
];
const closedPickedUpReadiness = computeDeliveryReadiness(
  closedPickedUpDelivery,
  closedPickedUpItems,
);
assert(
  "closed_picked_up import maps readiness deliveryStatus to picked_up",
  closedPickedUpReadiness.deliveryStatus === "picked_up",
  closedPickedUpReadiness.deliveryStatus,
);
assert(
  "closed_picked_up import display label is Picked Up",
  deliveryReadinessDisplayLabel(
    closedPickedUpDelivery,
    closedPickedUpReadiness,
    closedPickedUpItems,
  ) === "Picked Up",
);
const closedPickedUpListRow = {
  status: closedPickedUpReadiness.deliveryStatus,
  statusDisplayLabel: deliveryReadinessDisplayLabel(
    closedPickedUpDelivery,
    closedPickedUpReadiness,
    closedPickedUpItems,
  ),
};
assert(
  "closed_picked_up invoice rows hide from default board via complete filter",
  isCompleteOverviewRow(closedPickedUpListRow) &&
    rowMatchesOverviewStatusFilter(closedPickedUpListRow, "complete"),
);

assert(
  "legacy installed rows map to complete overview filter",
  rowMatchesOverviewStatusFilter(
    { status: "installed", statusDisplayLabel: "Complete" },
    "complete",
  ),
);

assert(
  "delivered and picked_up are not delivery overview filter chips",
  !DELIVERY_OVERVIEW_STATUS_ORDER.includes("delivered") &&
    !DELIVERY_OVERVIEW_STATUS_ORDER.includes("picked_up"),
);

const shellPatchImportDoc = {
  importStatus: "pickup_at_vendor",
  parsedHeader: { fulfillmentMethod: "will_call_pickup" },
};
const shellPatchContext = {
  deliveryOrderId: "delivery-vii-test",
  deliveryStatus: "ready_for_pickup",
  invoiceFulfillmentMethod: "will_call_pickup",
};
const pickedUpExisting = {
  status: "picked_up",
  invoiceImportStatus: "closed_picked_up",
};
const pickedUpPatch = buildInvoiceShellPatchDocument(
  shellPatchContext,
  "import-test",
  shellPatchImportDoc,
  "2026-08-05T00:00:00Z",
  pickedUpExisting,
);
assert(
  "invoice shell refresh preserves picked_up terminal status",
  isTerminalPickupShellDelivery(pickedUpExisting) &&
    pickedUpPatch.status === undefined &&
    pickedUpPatch.invoiceImportStatus === undefined &&
    pickedUpPatch.vendorInvoiceImportId === "import-test",
);
const freshPatch = buildInvoiceShellPatchDocument(
  shellPatchContext,
  "import-test",
  shellPatchImportDoc,
  "2026-08-05T00:00:00Z",
  { status: "ready_for_pickup", invoiceImportStatus: "pickup_at_vendor" },
);
assert(
  "invoice shell refresh still updates status for non-terminal deliveries",
  freshPatch.status === "ready_for_pickup" &&
    freshPatch.invoiceImportStatus === "pickup_at_vendor",
);

// --- Dispatcher operational fulfillment must survive create_shell / approve backfill ---
const willCallImportDoc = {
  importStatus: "pickup_at_vendor",
  parsedHeader: { fulfillmentMethod: "will_call_pickup" },
};
const willCallShellContext = {
  deliveryOrderId: "delivery-vii-fulfillment-preserve",
  deliveryStatus: "ready_for_pickup",
  invoiceFulfillmentMethod: "will_call_pickup",
};
const dropOffOpsExisting = {
  status: "pending",
  invoiceImportStatus: "pending",
  invoiceFulfillmentMethod: "delivery",
  plannedStagingLocationIds: ["zone-fixture-g12"],
};
assert(
  "shouldPreserve: Drop-Off ops vs Will-Call import",
  shouldPreserveExistingOperationalFulfillment(
    dropOffOpsExisting,
    "will_call_pickup",
  ),
);
const dropOffPreservePatch = buildInvoiceShellPatchDocument(
  willCallShellContext,
  "import-fulfillment-preserve",
  willCallImportDoc,
  "2026-08-09T00:00:00Z",
  dropOffOpsExisting,
);
assert(
  "Will-Call→Drop-Off ops survive shell create_shell backfill (no fulfillment/status/importStatus overwrite)",
  dropOffPreservePatch.invoiceFulfillmentMethod === undefined &&
    dropOffPreservePatch.status === undefined &&
    dropOffPreservePatch.invoiceImportStatus === undefined &&
    dropOffPreservePatch.vendorInvoiceImportId === "import-fulfillment-preserve" &&
    dropOffPreservePatch.plannedStagingLocationIds === undefined,
);

const willCallOpsExisting = {
  status: "ready_for_pickup",
  invoiceImportStatus: "pickup_at_vendor",
  invoiceFulfillmentMethod: "will_call_pickup",
};
const dropOffImportDoc = {
  importStatus: "pending",
  parsedHeader: { fulfillmentMethod: "delivery" },
};
const dropOffShellContext = {
  deliveryOrderId: "delivery-vii-fulfillment-preserve-rev",
  deliveryStatus: "pending",
  invoiceFulfillmentMethod: "delivery",
};
assert(
  "shouldPreserve: Will-Call ops vs Drop-Off import",
  shouldPreserveExistingOperationalFulfillment(
    willCallOpsExisting,
    "delivery",
  ),
);
const willCallPreservePatch = buildInvoiceShellPatchDocument(
  dropOffShellContext,
  "import-fulfillment-preserve-rev",
  dropOffImportDoc,
  "2026-08-09T00:00:00Z",
  willCallOpsExisting,
);
assert(
  "Drop-Off→Will-Call ops survive shell create_shell backfill",
  willCallPreservePatch.invoiceFulfillmentMethod === undefined &&
    willCallPreservePatch.status === undefined &&
    willCallPreservePatch.invoiceImportStatus === undefined,
);

const noFulfillmentExisting = {
  status: "pending",
  invoiceImportStatus: "pending",
};
const firstPatch = buildInvoiceShellPatchDocument(
  willCallShellContext,
  "import-first-patch",
  willCallImportDoc,
  "2026-08-09T00:00:00Z",
  noFulfillmentExisting,
);
assert(
  "missing fulfillment on delivery → import still wins on first patch",
  !shouldPreserveExistingOperationalFulfillment(
    noFulfillmentExisting,
    "will_call_pickup",
  ) &&
    firstPatch.invoiceFulfillmentMethod === "will_call_pickup" &&
    firstPatch.status === "ready_for_pickup" &&
    firstPatch.invoiceImportStatus === "pickup_at_vendor",
);

const matchingWillCallExisting = {
  status: "ready_for_pickup",
  invoiceImportStatus: "pickup_at_vendor",
  invoiceFulfillmentMethod: "will_call_pickup",
};
const matchingRefreshPatch = buildInvoiceShellPatchDocument(
  willCallShellContext,
  "import-matching-refresh",
  willCallImportDoc,
  "2026-08-09T00:00:00Z",
  matchingWillCallExisting,
);
assert(
  "matching fulfillment → normal shell refresh still writes status/importStatus/fulfillment",
  !shouldPreserveExistingOperationalFulfillment(
    matchingWillCallExisting,
    "will_call_pickup",
  ) &&
    matchingRefreshPatch.invoiceFulfillmentMethod === "will_call_pickup" &&
    matchingRefreshPatch.status === "ready_for_pickup" &&
    matchingRefreshPatch.invoiceImportStatus === "pickup_at_vendor",
);

const terminalDifferingOps = {
  status: "picked_up",
  invoiceImportStatus: "closed_picked_up",
  invoiceFulfillmentMethod: "delivery",
};
const terminalDifferingPatch = buildInvoiceShellPatchDocument(
  willCallShellContext,
  "import-terminal-differing",
  willCallImportDoc,
  "2026-08-09T00:00:00Z",
  terminalDifferingOps,
);
assert(
  "terminal pickup + differing ops both suppress status/importStatus; preserve also omits fulfillment",
  isTerminalPickupShellDelivery(terminalDifferingOps) &&
    shouldPreserveExistingOperationalFulfillment(
      terminalDifferingOps,
      "will_call_pickup",
    ) &&
    terminalDifferingPatch.status === undefined &&
    terminalDifferingPatch.invoiceImportStatus === undefined &&
    terminalDifferingPatch.invoiceFulfillmentMethod === undefined,
);

const matchedDropOffPreserve = buildInvoiceMatchedDeliveryPatchDocument(
  willCallShellContext,
  "import-matched-preserve",
  willCallImportDoc,
  "2026-08-09T00:00:00Z",
  dropOffOpsExisting,
);
assert(
  "matched-delivery patch preserves Drop-Off ops (no fulfillment/importStatus)",
  matchedDropOffPreserve.invoiceFulfillmentMethod === undefined &&
    matchedDropOffPreserve.invoiceImportStatus === undefined &&
    matchedDropOffPreserve.status === undefined &&
    matchedDropOffPreserve.vendorInvoiceImportId === "import-matched-preserve",
);
const matchedWillCallPreserve = buildInvoiceMatchedDeliveryPatchDocument(
  dropOffShellContext,
  "import-matched-preserve-rev",
  dropOffImportDoc,
  "2026-08-09T00:00:00Z",
  willCallOpsExisting,
);
assert(
  "matched-delivery patch preserves Will-Call ops (reverse)",
  matchedWillCallPreserve.invoiceFulfillmentMethod === undefined &&
    matchedWillCallPreserve.invoiceImportStatus === undefined,
);

assert(
  "CF: explicit Vendor Drop-Off wins over stale pickup_at_vendor import status",
  !skipsShopStagingCf({
    invoiceImportStatus: "pickup_at_vendor",
    invoiceFulfillmentMethod: "delivery",
    createdFromInvoiceImport: true,
  }) &&
    !isInvoiceShellNoShopStagingCf({
      invoiceImportStatus: "pickup_at_vendor",
      invoiceFulfillmentMethod: "delivery",
      createdFromInvoiceImport: true,
    }),
);
assert(
  "CF: explicit Will-Call still skips shop staging after toggle",
  skipsShopStagingCf({
    invoiceImportStatus: "pickup_at_vendor",
    invoiceFulfillmentMethod: "will_call_pickup",
    createdFromInvoiceImport: true,
  }) &&
    isInvoiceShellNoShopStagingCf({
      invoiceImportStatus: "pickup_at_vendor",
      invoiceFulfillmentMethod: "will_call_pickup",
      createdFromInvoiceImport: true,
    }),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
