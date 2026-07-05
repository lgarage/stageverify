import type { DeliveryOrder, Item, Job, MaterialIssue } from "./models";
import { vendorInvoiceImportDisplayLabel } from "./invoice/invoiceDisplayHelpers";
import type {
  DeliveryReadinessResult,
  JobReadinessResult,
  POReadinessResult,
} from "./readiness";

const OPEN_ISSUE_STATUSES = new Set(["open", "assigned"]);

function countOpenIssuesForLabel(
  delivery: Pick<DeliveryOrder, "openIssueCount">,
  materialIssues?: MaterialIssue[],
): number {
  if (materialIssues !== undefined) {
    return materialIssues.filter((issue) =>
      OPEN_ISSUE_STATUSES.has(issue.status),
    ).length;
  }
  return delivery.openIssueCount ?? 0;
}

export function deliveryReadinessDisplayLabel(
  delivery: DeliveryOrder,
  readiness: DeliveryReadinessResult,
  items: Item[] = [],
  materialIssues?: MaterialIssue[],
): string {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return "Picked Up";
  }
  if (delivery.invoiceImportStatus === "pickup_at_vendor") {
    return vendorInvoiceImportDisplayLabel("pickup_at_vendor").replace(/\.$/, "");
  }
  if (delivery.invoiceImportStatus === "closed_picked_up") {
    return vendorInvoiceImportDisplayLabel("closed_picked_up").replace(/\.$/, "");
  }
  if (
    delivery.invoiceDeliverToSite === true &&
    delivery.invoiceDeliverToSiteConfirmed === true
  ) {
    return "Delivered";
  }
  if (countOpenIssuesForLabel(delivery, materialIssues) > 0) {
    return "Issue / Review Required";
  }
  if (readiness.readyForPickup) {
    return "Ready for Pickup";
  }
  if (delivery.status === "issue") {
    return "Issue / Review Required";
  }

  const ordered = items.reduce((sum, item) => sum + item.qtyOrdered, 0);
  const received = items.reduce((sum, item) => sum + item.qtyReceived, 0);

  if (received > 0 && received < ordered) {
    return "Partial";
  }

  if (
    received === 0 &&
    (delivery.status === "pending" ||
      delivery.status === "shipped" ||
      delivery.status === "arrived" ||
      delivery.status === "partial")
  ) {
    return "Pending Delivery";
  }

  return "Incomplete";
}

export function poReadinessDisplayLabel(readiness: POReadinessResult): string {
  return readiness.readyForPickup ? "Ready for Pickup" : "Incomplete";
}

export function jobDispatchDisplayLabel(
  job: Job,
  deliveries: DeliveryOrder[],
  readiness: JobReadinessResult,
): string {
  if (deliveries.length === 0) {
    return "No deliveries";
  }

  const allPickedUp = deliveries.every(
    (d) => d.status === "picked_up" || d.status === "installed",
  );
  if (allPickedUp) {
    return "All Items Picked Up";
  }

  const anyPickedUp = deliveries.some(
    (d) => d.status === "picked_up" || d.status === "installed",
  );
  if (anyPickedUp) {
    return "Pickup in Progress";
  }

  if (readiness.allReadyForPickup) {
    return "Everything Ready for Pickup";
  }

  if (job.pickupScheduledAt) {
    return "Pickup Scheduled";
  }

  const readyCount = readiness.deliveryResults.filter((r) => r.readyForPickup)
    .length;
  if (readyCount > 0) {
    return `${readyCount} of ${deliveries.length} deliveries ready`;
  }

  return "In Progress";
}

export function showEverythingReadyBadge(
  deliveries: DeliveryOrder[],
  readiness: JobReadinessResult,
): boolean {
  return (
    deliveries.length > 0 &&
    readiness.allReadyForPickup &&
    !deliveries.every(
      (d) => d.status === "picked_up" || d.status === "installed",
    )
  );
}
