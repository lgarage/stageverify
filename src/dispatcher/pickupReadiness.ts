import type { DeliveryOrder, Item, VendorDeliveryMode } from "./models";
import {
  computeDeliveryReadiness,
  type DeliveryReadinessResult,
  type ReadinessComputeOptions,
} from "./readiness";

export interface PickupReadinessOptions extends ReadinessComputeOptions {
  vendorDeliveryMode?: VendorDeliveryMode;
}

function readinessOptions(
  options?: PickupReadinessOptions,
): ReadinessComputeOptions | undefined {
  if (!options?.vendorDeliveryMode && options?.openBlockingIssueCount === undefined) {
    return options;
  }
  return options;
}

export function pickupReadinessForDelivery(
  delivery: DeliveryOrder,
  items: Item[],
  options?: PickupReadinessOptions,
): DeliveryReadinessResult {
  return computeDeliveryReadiness(delivery, items, readinessOptions(options));
}

/** Computed pickup queue membership — not raw persisted status. */
export function isTechnicianPickupReady(
  delivery: DeliveryOrder,
  items: Item[],
  options?: PickupReadinessOptions,
): boolean {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return true;
  }
  return pickupReadinessForDelivery(delivery, items, options).readyForPickup;
}

export function pickupQueueSortRankForDelivery(
  delivery: DeliveryOrder,
  items: Item[],
  options?: PickupReadinessOptions,
): number {
  if (delivery.status === "picked_up" || delivery.status === "installed") {
    return 1;
  }
  if (pickupReadinessForDelivery(delivery, items, options).readyForPickup) {
    return 0;
  }
  return 2;
}

export function pickupNotReadyDetailLabel(
  result: DeliveryReadinessResult,
): string | null {
  if (result.readyForPickup) return null;
  const reasons = result.evidence.readinessBlockReasons;
  if (
    reasons.includes("physical_dropoff_incomplete") ||
    reasons.includes("unresolved_damage") ||
    reasons.includes("unresolved_backorder")
  ) {
    return "Not ready — partial receipt";
  }
  if (reasons.includes("staging_assignment_incomplete")) {
    return "Not ready — awaiting staging";
  }
  if (reasons.includes("vendor_order_incomplete")) {
    return "Not ready — awaiting vendor confirmation";
  }
  return "Not ready";
}

export function pickupPublicStatusLabel(
  delivery: DeliveryOrder,
  items: Item[],
  options?: PickupReadinessOptions,
): string | null {
  if (delivery.status === "picked_up") return "Picked up";
  if (delivery.status === "installed") return "Installed";
  if (isTechnicianPickupReady(delivery, items, options)) {
    return "Ready for pickup";
  }
  return null;
}
