/**
 * Unit tests — invoice shell staging exemption + job name resolution.
 * Usage: node scripts/test-invoice-shell-display.mjs
 */
import {
  buildDeliverToSiteIssueSummary,
  extractDeliverToSiteLabel,
  isDeliverToSiteConfirmed,
  isInvoiceShellNoShopStaging,
  jobNameFromInvoiceContext,
  resolveDeliveryPoNumber,
  resolveShellDeliveryStatus,
} from "../src/dispatcher/invoice/invoiceShellDisplayHelpers.ts";
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
  "will-call shell shows Will-Call Pickup in issue summary column",
  computeDeliveryDisplayState(willCallShellDelivery, willCallItems, [])
    .issueSummary === "Will-Call Pickup",
);

assert(
  "will-call shell staging list column is N/A gate",
  isWillCallPickupStagingListNa(willCallShellDelivery),
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
  "fulfillment-only will_call_pickup status label is Will-Call / Pickup",
  deliveryReadinessDisplayLabel(
    willCallFulfillmentOnlyDelivery,
    willCallFulfillmentReadiness,
    willCallItems,
  ) === "Will-Call / Pickup",
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
  "deliver-to-site confirmed display label is Complete",
  deliveryReadinessDisplayLabel(
    deliverToSiteConfirmedDelivery,
    deliverToSiteReadiness,
    deliverToSiteItems,
  ) === "Complete",
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
    confirmedPanel.deliveryStatusLabel === "Complete",
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
  "issue summary column empty when site delivery confirmed (status column shows Complete)",
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
    { status: "complete", statusDisplayLabel: "Ready for Pickup" },
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
