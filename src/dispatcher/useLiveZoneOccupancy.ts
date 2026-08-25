import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebaseDb";
import {
  parseStagingLocation,
  type DeliveryOrder,
  type ShopStockLocationMapping,
  type StagingLocation,
} from "./models";
import { mapActiveShopStockReservationsByCode } from "./shopStockMapping";
import {
  computeZoneOccupancyByCode,
  type ZoneOccupancySummaryWithReadiness,
} from "./zoneOccupancyCompute";

const LIVE_QUERY_LIMIT = 500;

export type LiveZoneOccupancyState = {
  zones: StagingLocation[];
  deliveries: DeliveryOrder[];
  occupancyByZoneCode: Record<string, ZoneOccupancySummaryWithReadiness>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
  ready: boolean;
  error: string | null;
};

const EMPTY: LiveZoneOccupancyState = {
  zones: [],
  deliveries: [],
  occupancyByZoneCode: {},
  shopStockByCode: {},
  ready: false,
  error: null,
};

/**
 * Multi-user live occupancy for the shop map.
 * Subscribes to stagingLocations, deliveries, and shopStockLocationMappings.
 */
export function useLiveZoneOccupancy(enabled: boolean): LiveZoneOccupancyState {
  const [state, setState] = useState<LiveZoneOccupancyState>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }

    let zones: StagingLocation[] = [];
    let deliveries: DeliveryOrder[] = [];
    let mappings: ShopStockLocationMapping[] = [];
    let zonesReady = false;
    let deliveriesReady = false;
    let mappingsReady = false;

    const publish = (error: string | null = null) => {
      setState({
        zones,
        deliveries,
        occupancyByZoneCode: computeZoneOccupancyByCode(
          zones,
          deliveries,
          "authoritative",
        ),
        shopStockByCode: mapActiveShopStockReservationsByCode(mappings),
        ready: zonesReady && deliveriesReady && mappingsReady,
        error,
      });
    };

    const unsubs: Unsubscribe[] = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, "stagingLocations"), limit(LIVE_QUERY_LIMIT)),
        (snap) => {
          zones = snap.docs.map((d) =>
            parseStagingLocation(d.id, d.data() as Record<string, unknown>),
          );
          zonesReady = true;
          publish();
        },
        (err) => {
          publish(err.message || "Failed to listen to staging locations.");
        },
      ),
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, "deliveries"), limit(LIVE_QUERY_LIMIT)),
        (snap) => {
          deliveries = snap.docs.map((d) => ({
            ...(d.data() as DeliveryOrder),
            id: d.id,
          }));
          deliveriesReady = true;
          publish();
        },
        (err) => {
          publish(err.message || "Failed to listen to deliveries.");
        },
      ),
    );

    unsubs.push(
      onSnapshot(
        query(
          collection(db, "shopStockLocationMappings"),
          limit(LIVE_QUERY_LIMIT),
        ),
        (snap) => {
          mappings = snap.docs.map((d) => ({
            ...(d.data() as ShopStockLocationMapping),
            id: d.id,
          }));
          mappingsReady = true;
          publish();
        },
        (err) => {
          publish(err.message || "Failed to listen to shop stock mappings.");
        },
      ),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [enabled]);

  return state;
}
