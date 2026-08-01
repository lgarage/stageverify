import type { DeliveryOrder, Item, Job, MaterialIssue } from "./models";
import {
  countOpenBlockingIssues,
  isReservedDisplayState,
  isWillCallPickupStagingListNa,
} from "./deliveryDisplayHelpers";
import { vendorInvoiceImportDisplayLabel } from "./invoice/invoiceDisplayHelpers";
import type {
  DeliveryReadinessResult,
  JobReadinessResult,
  POReadinessResult,
} from "./readiness";

/** List + drawer status when shop is waiting for inbound material (0 received). */
export const AWAITING_DELIVERY_STATUS_LABEL = "Awaiting Delivery";

export function deliveryReadinessDisplayLabel(
  delivery: DeliveryOrder,
  readiness: DeliveryReadinessResult,
  items: Item[] = [],
  materialIssues?: MaterialIssue[],
): string {
  if (
    delivery.status === "complete" ||
    delivery.status === "picked_up" ||
    delivery.status === "installed" ||
    (delivery.invoiceDeliverToSite === true &&
      delivery.invoiceDeliverToSiteConfirmed === true)
  ) {
    return "Complete";
  }
  if (isWillCallPickupStagingListNa(delivery)) {
    return vendorInvoiceImportDisplayLabel("pickup_at_vendor").replace(/\.$/, "");
  }
  if (delivery.invoiceImportStatus === "closed_picked_up") {
    return vendorInvoiceImportDisplayLabel("closed_picked_up").replace(/\.$/, "");
  }
  if (countOpenBlockingIssues(delivery, materialIssues) > 0) {
    return "Issue / Review Required";
  }

  const ordered = items.reduce((sum, item) => sum + item.qtyOrdered, 0);
  const received = items.reduce((sum, item) => sum + item.qtyReceived, 0);

  if (
    received === 0 &&
    (delivery.status === "pending" ||
      delivery.status === "shipped" ||
      delivery.status === "arrived" ||
      delivery.status === "partial")
  ) {
    return AWAITING_DELIVERY_STATUS_LABEL;
  }

  if (isReservedDisplayState(delivery)) {
    return "Reserved";
  }
  if (readiness.readyForPickup) {
    return "Ready for Pickup";
  }
  if (delivery.status === "issue") {
    return "Issue / Review Required";
  }

  if (received > 0 && received < ordered) {
    return "Partial";
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
