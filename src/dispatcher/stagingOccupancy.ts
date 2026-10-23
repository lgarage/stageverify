import {
  ZONE_CLEARED_DELIVERY_STATUSES,
  getAllStagingLocationIds,
  isLocationActive,
  isOversizedSpot,
  type DeliveryOrder,
  type StagingLocation,
} from "./models";
import { skipsShopStaging } from "./invoice/invoiceShellDisplayHelpers";

export type ShopOccupancyMode = "board" | "authoritative";

function deliveryHasStagingRef(
  delivery: Pick<
    DeliveryOrder,
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
  >,
): boolean {
  if (delivery.stagingLocationId?.trim()) return true;
  if (
    (delivery.additionalStagingLocationIds ?? []).some(
      (id) => typeof id === "string" && id.trim().length > 0,
    )
  ) {
    return true;
  }
  return (delivery.plannedStagingLocationIds ?? []).some(
    (id) => typeof id === "string" && id.trim().length > 0,
  );
}

/**
 * Vendor Drop-Off marked picked_up/complete/installed without a shop receipt,
 * then given a planned/actual spot (6169474 PO 2205 EARLY / S1-E).
 * Real shop pickups stay ZONE_CLEARED so leftover ids cannot hold the map.
 */
export function zoneClearedDeliveryStillOccupiesShop(
  delivery: Pick<
    DeliveryOrder,
    | "status"
    | "invoiceFulfillmentMethod"
    | "physicalDropoffComplete"
    | "stagingLocationId"
    | "additionalStagingLocationIds"
    | "plannedStagingLocationIds"
    | "invoiceImportStatus"
    | "createdFromInvoiceImport"
    | "id"
    | "vendorInvoiceImportId"
    | "invoiceDeliverToSite"
  >,
): boolean {
  if (!ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) return false;
  if (delivery.invoiceFulfillmentMethod !== "delivery") return false;
  if (delivery.physicalDropoffComplete !== false) return false;
  if (skipsShopStaging(delivery)) return false;
  return deliveryHasStagingRef(delivery);
}

/** Whether this delivery may paint / block a shop spot in the given occupancy mode. */
export function deliveryCountsTowardZoneOccupancy(
  delivery: DeliveryOrder,
  mode: ShopOccupancyMode = "board",
): boolean {
  if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) {
    return zoneClearedDeliveryStillOccupiesShop(delivery);
  }
  if (mode !== "authoritative" && skipsShopStaging(delivery)) return false;
  return true;
}

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
    // ZONE_CLEARED leftovers do not block — except VDO with no shop receipt
    // that still carries a planned/actual spot (same set as map occupancy).
    if (!deliveryCountsTowardZoneOccupancy(delivery, "authoritative")) continue;
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
