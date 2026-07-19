import type { DeliveryOrder, StagingLocation } from "./models";
import {
  ZONE_CLEARED_DELIVERY_STATUSES,
  effectiveReadinessStatus,
  getAllStagingLocationIds,
} from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";
import type { ZoneOccupancySummary } from "./firestoreService";

export type ZoneOccupancySummaryWithReadiness = ZoneOccupancySummary & {
  readyForPickup: boolean;
  /** True when this code is only planned (not in actual staging ids). */
  plannedOnly: boolean;
};

function locationIdsForMapColor(delivery: DeliveryOrder): string[] {
  const actual = getAllStagingLocationIds(delivery);
  const planned = delivery.plannedStagingLocationIds ?? [];
  return [...new Set([...actual, ...planned])];
}

/**
 * Pure occupancy reducer — used by one-shot fetch and live onSnapshot paths.
 * Includes plannedStagingLocationIds so orange covers assigned OR planned.
 */
export function computeZoneOccupancyByCode(
  locations: StagingLocation[],
  deliveries: DeliveryOrder[],
): Record<string, ZoneOccupancySummaryWithReadiness> {
  const byCode: Record<string, ZoneOccupancySummaryWithReadiness> = {};
  const locById = new Map(locations.map((loc) => [loc.id, loc]));

  const shouldReplace = (
    existing: ZoneOccupancySummaryWithReadiness,
    candidate: DeliveryOrder,
  ): boolean => {
    const prev = deliveries.find((d) => d.id === existing.deliveryId);
    return Boolean(
      prev && candidate.updatedAt.localeCompare(prev.updatedAt) > 0,
    );
  };

  for (const delivery of deliveries) {
    if (ZONE_CLEARED_DELIVERY_STATUSES.has(delivery.status)) continue;
    const actualIds = new Set(getAllStagingLocationIds(delivery));
    const readyForPickup =
      effectiveReadinessStatus(delivery) === "ready_for_pickup";
    const summaryBase = {
      deliveryId: delivery.id,
      orderNumber: delivery.orderNumber,
      vendorName: delivery.vendorName?.trim() || "Vendor",
      jobId: delivery.jobId,
      status: delivery.status,
      readyForPickup,
    };

    for (const locId of locationIdsForMapColor(delivery)) {
      const location = locById.get(locId);
      if (!location) continue;
      const key = normalizeStagingCodeKey(location.code);
      const candidate: ZoneOccupancySummaryWithReadiness = {
        ...summaryBase,
        plannedOnly: !actualIds.has(locId),
      };
      const existing = byCode[key];
      if (!existing || shouldReplace(existing, delivery)) {
        byCode[key] = candidate;
      }
    }
  }

  return byCode;
}
