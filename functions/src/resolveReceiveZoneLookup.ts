import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getAllStagingLocationIds,
  RECEIVE_BLOCKED_DELIVERY_STATUSES,
  ZONE_CLEARED_DELIVERY_STATUSES,
} from "./deliveryDetailsResponse";

function getDb() {
  return admin.firestore();
}

interface ResolveReceiveZoneLookupRequest {
  zoneCode?: string;
}

function asZoneCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  return trimmed;
}

/** Pre-PIN zone routing — returns deliveryId only, no delivery/item hydration. */
export const resolveReceiveZoneLookup = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const zoneCode = asZoneCode(
      (request.data as ResolveReceiveZoneLookupRequest)?.zoneCode,
    );
    if (!zoneCode) {
      throw new HttpsError("invalid-argument", "Invalid zone code.");
    }

    const db = getDb();
    const locSnap = await db
      .collection("stagingLocations")
      .where("code", "==", zoneCode)
      .limit(1)
      .get();
    if (locSnap.empty) {
      return { found: false as const };
    }
    const locationId = locSnap.docs[0].id;

    const deliveriesSnap = await db.collection("deliveries").limit(500).get();
    const candidates = deliveriesSnap.docs.filter((docSnap) => {
      const delivery = docSnap.data();
      const status = delivery.status as string;
      if (ZONE_CLEARED_DELIVERY_STATUSES.has(status as never)) return false;
      return getAllStagingLocationIds(delivery).includes(locationId);
    });

    if (candidates.length === 0) {
      return { found: false as const };
    }

    const sorted = [...candidates].sort((a, b) => {
      const aUpdated = String(a.data().updatedAt ?? "");
      const bUpdated = String(b.data().updatedAt ?? "");
      return bUpdated.localeCompare(aUpdated);
    });
    const chosen = sorted[0];
    const delivery = chosen.data();
    const deliveryId = chosen.id;
    const status = delivery.status as string;

    if (RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status as never)) {
      return {
        found: true as const,
        kind: "pickup" as const,
        jobId: String(delivery.jobId ?? ""),
        deliveryId,
      };
    }

    return {
      found: true as const,
      kind: "receive" as const,
      deliveryId,
    };
  },
);
