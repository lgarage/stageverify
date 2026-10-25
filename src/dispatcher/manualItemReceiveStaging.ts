import type { DeliveryOrder, StagingLocation } from "./models";
import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";
import { formatStagingCodeCanonical } from "./stagingCode";

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
function resolveStagingLocationRef(
  rawId: string,
  locById: Map<string, StagingLocation>,
  locByCodeKey: Map<string, StagingLocation>,
): StagingLocation | undefined {
  const id = rawId.trim();
  if (!id) return undefined;
  const byId = locById.get(id);
  if (byId?.id) return byId;
  return locByCodeKey.get(formatStagingCodeCanonical(id));
}

/**
 * When physical staging is missing but the delivery has exactly one resolvable
 * assigned spot, Order Summary Delivered can confirm in the drawer (PS-1).
 */
export function resolveManualDeliveredInlineStagingConfirm(
  delivery: Pick<
    DeliveryOrder,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >,
  stagingLocations: StagingLocation[],
): { locationId: string; locationCode: string } | null {
  if (deliveryHasActualPhysicalStaging(delivery)) return null;

  const locById = new Map(stagingLocations.map((loc) => [loc.id, loc]));
  const locByCodeKey = new Map<string, StagingLocation>();
  for (const loc of stagingLocations) {
    const key = formatStagingCodeCanonical(loc.code);
    if (key) locByCodeKey.set(key, loc);
  }

  const rawRefs = [
    ...(delivery.plannedStagingLocationIds ?? []),
    ...(delivery.stagingLocationId?.trim()
      ? [delivery.stagingLocationId.trim()]
      : []),
    ...(delivery.additionalStagingLocationIds ?? []),
  ]
    .map((ref) => (typeof ref === "string" ? ref.trim() : ""))
    .filter(Boolean);

  const uniqueLocations = new Map<string, StagingLocation>();
  let unresolved = 0;
  for (const raw of rawRefs) {
    const loc = resolveStagingLocationRef(raw, locById, locByCodeKey);
    if (!loc?.id) {
      unresolved += 1;
      continue;
    }
    uniqueLocations.set(loc.id, loc);
  }

  // One deleted/unknown ref plus one real spot is not "exactly one assigned spot".
  if (unresolved > 0) return null;
  if (uniqueLocations.size !== 1) return null;

  const loc = uniqueLocations.values().next().value as StagingLocation;
  const code = formatStagingCodeCanonical(loc.code);
  if (!code.trim()) return null;
  return { locationId: loc.id, locationCode: code };
}

export function buildManualDeliveredInlineConfirmMessage(
  locationCode: string,
): string {
  return `Was this delivered to ${locationCode}?`;
}

export interface ManualDeliveredSpotCommit {
  deliveryFields: {
    stagingLocationId: string;
    plannedStagingLocationIds: string[];
    lastCheckmarkAt: string;
    updatedAt: string;
  };
  /** Planned ids that are not the confirmed location (code-form leftovers). */
  releasedPlannedIds: string[];
  itemFields: {
    qtyReceived: number;
    qtyMissing: number;
    status: "received" | "partial" | "missing";
  };
}

/**
 * One payload for the inline confirm write. Staging, planned-clear, and
 * received qty commit together so a failure cannot leave Delivered without
 * a spot or a spot without Delivered.
 */
export function buildManualDeliveredSpotCommit(input: {
  stagingLocationId: string;
  plannedStagingLocationIds?: string[];
  qtyOrdered: number;
  qtyReceived: number;
  qtyMissing: number;
  now: string;
}): ManualDeliveredSpotCommit {
  const stagingLocationId = input.stagingLocationId.trim();
  const planned = (input.plannedStagingLocationIds ?? [])
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
  let status: ManualDeliveredSpotCommit["itemFields"]["status"] = "missing";
  if (input.qtyReceived >= input.qtyOrdered) status = "received";
  else if (input.qtyReceived > 0) status = "partial";
  return {
    deliveryFields: {
      stagingLocationId,
      plannedStagingLocationIds: [],
      lastCheckmarkAt: input.now,
      updatedAt: input.now,
    },
    releasedPlannedIds: planned.filter((id) => id !== stagingLocationId),
    itemFields: {
      qtyReceived: input.qtyReceived,
      qtyMissing: input.qtyMissing,
      status,
    },
  };
}

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
