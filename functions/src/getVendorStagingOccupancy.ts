import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";
import {
  getAllStagingLocationIds,
  ZONE_CLEARED_DELIVERY_STATUSES,
} from "./deliveryDetailsResponse";

function getDb() {
  return admin.firestore();
}

interface StagingLocationOccupant {
  deliveryId: string;
  orderNumber: string;
  vendorName: string;
  locationId: string;
  locationCode: string;
}

interface GetVendorStagingOccupancyRequest {
  deliveryId?: string;
  sessionToken?: string;
  excludeDeliveryId?: string;
}

function denormalizedVendorName(delivery: admin.firestore.DocumentData): string {
  return typeof delivery.vendorName === "string" && delivery.vendorName.trim()
    ? delivery.vendorName.trim()
    : "Vendor";
}

/** Session-gated staging occupancy map for vendor Need More Space flows. */
export const getVendorStagingOccupancy = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as GetVendorStagingOccupancyRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const excludeDeliveryId =
      asDeliveryId(data.excludeDeliveryId) ?? deliveryId ?? undefined;

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const db = getDb();
    const sessionDeliverySnap = await db
      .collection("deliveries")
      .doc(deliveryId)
      .get();
    const sessionJobId = sessionDeliverySnap.exists
      ? String(sessionDeliverySnap.data()?.jobId ?? "")
      : "";

    const [locationsSnap, deliveriesSnap] = await Promise.all([
      db.collection("stagingLocations").limit(500).get(),
      db.collection("deliveries").limit(500).get(),
    ]);

    const locations = locationsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      code: String(docSnap.data().code ?? docSnap.id),
    }));

    const byLocationId: Record<string, StagingLocationOccupant> = {};

    for (const docSnap of deliveriesSnap.docs) {
      const delivery = docSnap.data();
      if (excludeDeliveryId && docSnap.id === excludeDeliveryId) continue;
      const status = delivery.status as string;
      if (ZONE_CLEARED_DELIVERY_STATUSES.has(status as never)) continue;

      for (const locId of getAllStagingLocationIds(delivery)) {
        const location = locations.find((loc) => loc.id === locId);
        const isOwnJob =
          sessionJobId.length > 0 && String(delivery.jobId ?? "") === sessionJobId;
        const occupant: StagingLocationOccupant = {
          deliveryId: docSnap.id,
          orderNumber: isOwnJob ? String(delivery.orderNumber ?? "") : "Occupied",
          vendorName: isOwnJob ? denormalizedVendorName(delivery) : "",
          locationId: locId,
          locationCode: location?.code ?? locId,
        };
        const existing = byLocationId[locId];
        if (!existing) {
          byLocationId[locId] = occupant;
          continue;
        }
        const prev = deliveriesSnap.docs.find((d) => d.id === existing.deliveryId);
        const prevUpdated = String(prev?.data().updatedAt ?? "");
        const candidateUpdated = String(delivery.updatedAt ?? "");
        if (candidateUpdated.localeCompare(prevUpdated) > 0) {
          byLocationId[locId] = occupant;
        }
      }
    }

    return { occupancy: byLocationId };
  },
);
