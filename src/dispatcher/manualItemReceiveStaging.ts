import type { DeliveryOrder } from "./models";
import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";

/**
 * Authoritative physical shop staging on the delivery document.
 * Excludes plannedStagingLocationIds — planned ≠ confirmed physical (PR #216).
 */
export function deliveryHasActualPhysicalStaging(
  delivery: Pick<
    DeliveryOrder,
    "stagingLocationId" | "additionalStagingLocationIds"
  >,
): boolean {
  if (delivery.stagingLocationId?.trim()) return true;
  return (delivery.additionalStagingLocationIds ?? []).some(
    (id) => typeof id === "string" && id.trim().length > 0,
  );
}

/**
 * Any staging ref on the delivery (actual or planned).
 * Used to choose reassign vs first-physical assign on the map — planned ≠ physical.
 */
export function deliveryHasAnyStagingRefs(
  delivery: Pick<
    DeliveryOrder,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >,
): boolean {
  if (deliveryHasActualPhysicalStaging(delivery)) return true;
  return (delivery.plannedStagingLocationIds ?? []).some(
    (id) => typeof id === "string" && id.trim().length > 0,
  );
}

/** True when Order Summary Delivered must block until physical staging is captured. */
export function manualDeliveredRequiresPhysicalStagingGate(
  delivery: DeliveryOrder,
  status: "Not Delivered" | "Delivered",
): boolean {
  if (status !== "Delivered") return false;
  if (skipsShopStaging(delivery)) return false;
  return !deliveryHasActualPhysicalStaging(delivery);
}

export interface PendingManualItemReceive {
  deliveryId: string;
  itemId: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  createdAt: string;
}

const STORAGE_KEY = "sv-pending-manual-item-receive";

export function writePendingManualItemReceive(
  pending: PendingManualItemReceive,
): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    /* sessionStorage unavailable */
  }
}

export function readPendingManualItemReceive(
  deliveryId: string,
): PendingManualItemReceive | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingManualItemReceive;
    if (parsed.deliveryId !== deliveryId) return null;
    if (typeof parsed.itemId !== "string" || !parsed.itemId.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingManualItemReceive(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

/** Staging Map assign flow — first physical via updateStagingLocation, or reassign CF when refs exist. */
export function buildManualReceiveStagingNavigateUrl(
  deliveryId: string,
  itemId: string,
  options?: { reassign?: boolean },
): string {
  const params = new URLSearchParams({
    assignDelivery: deliveryId,
    pendingItemReceive: itemId,
  });
  if (options?.reassign === true) {
    params.set("reassign", "1");
  }
  return `/zones?${params.toString()}`;
}
