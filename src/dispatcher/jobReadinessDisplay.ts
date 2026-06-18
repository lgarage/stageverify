import type { DeliveryOrder, Job } from "./models";
import type {
  DeliveryReadinessResult,
  JobReadinessResult,
  POReadinessResult,
} from "./readiness";

export function deliveryReadinessDisplayLabel(
  delivery: DeliveryOrder,
  readiness: DeliveryReadinessResult,
): string {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return "Picked Up";
  }
  if ((delivery.openIssueCount ?? 0) > 0) {
    return "Issue / Review Required";
  }
  if (readiness.readyForPickup) {
    return "Ready for Pickup";
  }
  if (delivery.status === "pending" || delivery.status === "shipped") {
    return "Awaiting Vendor Delivery";
  }
  if (delivery.status === "issue") {
    return "Issue / Review Required";
  }
  if (delivery.status === "partial" || delivery.status === "arrived") {
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
