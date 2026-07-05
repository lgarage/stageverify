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
  isDeliveredToSiteListRow,
  rowMatchesOverviewStatusFilter,
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
  "deliver-to-site confirmed display label is Delivered (not Complete)",
  deliveryReadinessDisplayLabel(
    deliverToSiteConfirmedDelivery,
    deliverToSiteReadiness,
    deliverToSiteItems,
  ) === "Delivered",
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
    confirmedPanel.deliveryStatusLabel === "Delivered",
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
  "issue summary column empty when site delivery confirmed (status column shows Delivered)",
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

const deliveredListRow = {
  status: "complete",
  statusDisplayLabel: "Delivered",
};
assert(
  "delivered overview filter matches deliver-to-site label only",
  isDeliveredToSiteListRow(deliveredListRow) &&
    rowMatchesOverviewStatusFilter(deliveredListRow, "delivered") &&
    rowMatchesOverviewStatusFilter(deliveredListRow, "complete") &&
    !rowMatchesOverviewStatusFilter(deliveredListRow, "ready_for_pickup"),
);

assert(
  "complete overview filter excludes non-delivered complete rows from delivered chip",
  !rowMatchesOverviewStatusFilter(
    { status: "complete", statusDisplayLabel: "Ready for Pickup" },
    "delivered",
  ) &&
    rowMatchesOverviewStatusFilter(
      { status: "complete", statusDisplayLabel: "Ready for Pickup" },
      "complete",
    ),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
