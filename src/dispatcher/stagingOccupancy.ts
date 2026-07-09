import {
  getAllStagingLocationIds,
  isLocationActive,
  isOversizedSpot,
  type DeliveryOrder,
  type StagingLocation,
} from "./models";

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
