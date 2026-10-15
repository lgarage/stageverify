import {
  ZONE_CLEARED_DELIVERY_STATUSES,
  getAllStagingLocationIds,
  isLocationActive,
  isOversizedSpot,
  type DeliveryOrder,
  type StagingLocation,
} from "./models";
import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";

/** Thrown when assigning a staging zone already held by another active delivery. */
export class StagingLocationOccupiedError extends Error {
  readonly code = "STAGING_LOCATION_OCCUPIED";
  readonly locationCode: string;
  readonly orderNumber: string;

  constructor(locationCode: string, orderNumber: string) {
    super(
      `Zone ${locationCode} is already assigned to order ${orderNumber}. Pick another spot.`,
    );
    this.name = "StagingLocationOccupiedError";
    this.locationCode = locationCode;
    this.orderNumber = orderNumber;
  }
}

export function deliveryUsesStagingLocation(
  delivery: DeliveryOrder,
  locationId: string,
): boolean {
  return getAllStagingLocationIds(delivery).includes(locationId);
}

/**
 * Actual or planned staging ref on this delivery (exact location id).
 * A planned ref must not skip availability checks: another order may
 * already hold the spot, and shop-stock reservation still applies.
 */
export function deliveryReferencesStagingLocation(
  delivery: DeliveryOrder,
  locationId: string,
): boolean {
  const target = locationId.trim();
  if (!target) return false;
  if (deliveryUsesStagingLocation(delivery, target)) return true;
  return (delivery.plannedStagingLocationIds ?? []).some(
    (id) => typeof id === "string" && id.trim() === target,
  );
}

/**
 * updateStagingLocation skips the availability assert only when this
 * delivery already has the spot as actual staging. Planned-only does not.
 */
export function mustAssertStagingLocationAvailable(
  delivery: DeliveryOrder,
  locationId: string,
): boolean {
  return !deliveryUsesStagingLocation(delivery, locationId.trim());
}

/**
 * Another non-cleared delivery already has this location id as actual or
 * planned staging. Matches the reassign CF occupant rule (includes will-call).
 * Cleared deliveries and this delivery are ignored.
 */
export function findConflictingStagingHolder(
  deliveries: DeliveryOrder[],
  excludeDeliveryId: string,
  locationId: string,
): DeliveryOrder | undefined {
  const target = locationId.trim();
  if (!target) return undefined;
  for (const delivery of deliveries) {
    if (delivery.id === excludeDeliveryId) continue;
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) continue;
    if (deliveryReferencesStagingLocation(delivery, target)) return delivery;
  }
  return undefined;
}

export function isStagingLocationOccupiedError(
  err: unknown,
): err is StagingLocationOccupiedError {
  return err instanceof StagingLocationOccupiedError;
}

/** Location ids this delivery already uses plus every spot held by another active order. */
export function buildBlockedStagingLocationIds(
  delivery: DeliveryOrder,
  occupiedLocationIds: Iterable<string>,
): Set<string> {
  return new Set([
    ...getAllStagingLocationIds(delivery),
    ...occupiedLocationIds,
  ]);
}

const sortByProximity = (a: StagingLocation, b: StagingLocation): number =>
  (a.sortOrder ?? 999) - (b.sortOrder ?? 999);

const isShelfType = (type: StagingLocation["type"]): boolean =>
  type === "shelf" || type === "bin";

function pickNearestSpot(
  locations: StagingLocation[],
  blocked: Set<string>,
  matches: (loc: StagingLocation) => boolean,
): StagingLocation | undefined {
  return locations
    .filter(
      (loc) =>
        isLocationActive(loc) && !blocked.has(loc.id) && matches(loc),
    )
    .sort(sortByProximity)[0];
}

export interface NeedMoreSpaceRecommendations {
  shelfSpot?: StagingLocation;
  groundSpot?: StagingLocation;
  oversizedSpot?: StagingLocation;
  /** Phase 4 — adjacent ground string suggestions (same adjacentGroupId). */
  adjacentGroundSpots?: StagingLocation[];
}

/** D14 — spots assigned/planned on any delivery (exclude current delivery). */
export function buildGloballyAssignedStagingLocationIds(
  allDeliveries: DeliveryOrder[],
  excludeDeliveryId: string,
): Set<string> {
  const ids = new Set<string>();
  for (const delivery of allDeliveries) {
    if (delivery.id === excludeDeliveryId) continue;
    // Will-Call / no-shop-staging do not hold shop spots for assignment blocking.
    if (skipsShopStaging(delivery)) continue;
    // Picked up / installed must not block assignment via stale planned refs.
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) continue;
    for (const locId of delivery.plannedStagingLocationIds ?? []) {
      ids.add(locId);
    }
    for (const locId of getAllStagingLocationIds(delivery)) {
      ids.add(locId);
    }
  }
  return ids;
}

function collectAdjacentGroundSpots(
  anchor: StagingLocation | undefined,
  allLocations: StagingLocation[],
  blocked: Set<string>,
): StagingLocation[] {
  if (!anchor?.adjacentGroupId?.trim()) return [];
  const groupId = anchor.adjacentGroupId.trim();
  return allLocations
    .filter(
      (loc) =>
        isLocationActive(loc) &&
        !blocked.has(loc.id) &&
        loc.type === "ground" &&
        loc.adjacentGroupId?.trim() === groupId,
    )
    .sort(sortByProximity);
}

/** Nearest free shelf, ground, and oversized spots (skips occupied + already on this delivery). */
export function recommendNeedMoreSpaceSpots(
  allLocations: StagingLocation[],
  delivery: DeliveryOrder,
  occupiedLocationIds: Iterable<string>,
  globallyAssignedIds?: Iterable<string>,
): NeedMoreSpaceRecommendations {
  const blocked = buildBlockedStagingLocationIds(
    delivery,
    occupiedLocationIds,
  );
  if (globallyAssignedIds) {
    for (const id of globallyAssignedIds) blocked.add(id);
  }
  const groundSpot = pickNearestSpot(
    allLocations,
    blocked,
    (loc) => !isOversizedSpot(loc) && loc.type === "ground",
  );
  return {
    shelfSpot: pickNearestSpot(
      allLocations,
      blocked,
      (loc) => !isOversizedSpot(loc) && isShelfType(loc.type),
    ),
    groundSpot,
    oversizedSpot: pickNearestSpot(
      allLocations,
      blocked,
      (loc) => loc.type === "ground" && isOversizedSpot(loc),
    ),
    adjacentGroundSpots: collectAdjacentGroundSpots(
      groundSpot,
      allLocations,
      blocked,
    ),
  };
}
