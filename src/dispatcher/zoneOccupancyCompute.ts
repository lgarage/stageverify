import type { DeliveryOrder, StagingLocation } from "./models";
import {
  ZONE_CLEARED_DELIVERY_STATUSES,
  effectiveReadinessStatus,
  getAllStagingLocationIds,
} from "./models";
import { normalizeStagingCodeKey } from "./stagingCode";
import { CATCH_ALL_ZONE_CODE } from "./shopMapLayout";
import type { ZoneOccupancySummary } from "./firestoreService";

const CATCH_ALL_KEY = normalizeStagingCodeKey(CATCH_ALL_ZONE_CODE);

/** Same ids/pattern as dispatcher list (hideSeedDemoRows) — map occupancy must match board. */
const SEED_DEMO_DELIVERY_IDS = new Set([
  "delivery-1",
  "delivery-2",
  "delivery-3",
  "delivery-cross-vendor-1",
  "delivery-demo-vendor-1",
  "delivery-demo-vendor-2",
]);

const SEED_DEMO_ORDER_PATTERN = /^ORD-00[1-7]$/;

export function isSeedDemoDelivery(delivery: DeliveryOrder): boolean {
  if (SEED_DEMO_DELIVERY_IDS.has(delivery.id)) return true;
  const orderNumber = delivery.orderNumber?.trim() ?? "";
  return SEED_DEMO_ORDER_PATTERN.test(orderNumber);
}

/**
 * Deliveries that may paint staging occupancy (map + list/drawer chips).
 * Prod: same exclusions as dispatcher Deliveries list (seed demos + non-invoice rows).
 */
export function filterDeliveriesForBoardStagingOccupancy(
  deliveries: DeliveryOrder[],
): DeliveryOrder[] {
  if (!import.meta.env.PROD) return deliveries;
  return deliveries.filter((delivery) => {
    if (isSeedDemoDelivery(delivery)) return false;
    if (!delivery.vendorInvoiceImportId?.trim()) return false;
    return true;
  });
}

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
  const stagingDeliveries = filterDeliveriesForBoardStagingOccupancy(deliveries);

  const shouldReplace = (
    existing: ZoneOccupancySummaryWithReadiness,
    candidate: DeliveryOrder,
  ): boolean => {
    const prev = stagingDeliveries.find((d) => d.id === existing.deliveryId);
    return Boolean(
      prev && candidate.updatedAt.localeCompare(prev.updatedAt) > 0,
    );
  };

  for (const delivery of stagingDeliveries) {
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
      const codeKey = normalizeStagingCodeKey(location.code);
      // Catch-all must never dual-key onto G1–G12 via a stale mapLayoutSlot.
      const keys = new Set<string>();
      if (codeKey === CATCH_ALL_KEY) {
        keys.add(CATCH_ALL_KEY);
      } else {
        keys.add(codeKey);
        const layoutSlot = location.mapLayoutSlot?.trim();
        if (layoutSlot) {
          const slotKey = normalizeStagingCodeKey(layoutSlot);
          if (slotKey !== CATCH_ALL_KEY) {
            keys.add(slotKey);
          }
        }
      }
      const candidate: ZoneOccupancySummaryWithReadiness = {
        ...summaryBase,
        plannedOnly: !actualIds.has(locId),
      };
      for (const key of keys) {
        const existing = byCode[key];
        if (!existing || shouldReplace(existing, delivery)) {
          byCode[key] = candidate;
        }
      }
    }
  }

  return byCode;
}
