import {
  DELIVERY_STATUS_LABEL,
  type DeliveryOrder,
  type Item,
  type Job,
  type MaterialIssue,
} from "./models";
import {
  countOpenBlockingIssues,
  isReservedDisplayState,
} from "./deliveryDisplayHelpers";
import type {
  DeliveryReadinessResult,
  JobReadinessResult,
  POReadinessResult,
} from "./readiness";

const STAGED_READY_LABEL = DELIVERY_STATUS_LABEL.ready_for_pickup;

/** List + drawer status when shop is waiting for inbound material (0 received). */
export const AWAITING_DELIVERY_STATUS_LABEL = "Assigned / Planned";

/** Primary list/drawer status when vendor unplanned delivery needs job/PO match. */
export const UNPLANNED_STATUS_LABEL = "Unplanned";

export function deliveryNeedsUnplannedJobMatch(
  delivery: Pick<DeliveryOrder, "unplanned" | "reviewFlag">,
): boolean {
  if (delivery.unplanned === true) return true;
  return (
    delivery.reviewFlag?.flagged === true &&
    /unplanned/i.test(delivery.reviewFlag.reason ?? "")
  );
}

export function deliveryReadinessDisplayLabel(
  delivery: DeliveryOrder,
  readiness: DeliveryReadinessResult,
  items: Item[] = [],
  materialIssues?: MaterialIssue[],
): string {
  if (
    delivery.status === "picked_up" ||
    delivery.status === "installed" ||
    delivery.invoiceImportStatus === "closed_picked_up" ||
    (delivery.invoiceDeliverToSite === true &&
      delivery.invoiceDeliverToSiteConfirmed === true)
  ) {
    return "Picked Up";
  }
  if (delivery.status === "complete") {
    return "Picked Up";
  }
  if (deliveryNeedsUnplannedJobMatch(delivery)) {
    return UNPLANNED_STATUS_LABEL;
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
    return STAGED_READY_LABEL;
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
  return readiness.readyForPickup ? STAGED_READY_LABEL : "Incomplete";
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
    return `Everything ${STAGED_READY_LABEL}`;
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
