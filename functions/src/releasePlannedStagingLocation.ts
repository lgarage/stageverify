/**
 * Vendor planned-spot release — session-gated (location-first D4).
 * "No" removes from plannedStagingLocationIds + audit entry.
 * "Yes" assigns the spot as actual (same occupancy rules as assignVendorStagingLocation).
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getAllStagingLocationIds,
} from "./deliveryDetailsResponse";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

interface ReleasePlannedStagingRequest {
  deliveryId?: string;
  sessionToken?: string;
  locationId?: string;
  placed?: boolean;
}

function asStagingLocationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function asPlacedFlag(value: unknown): boolean {
  return value === true;
}

function deliveryUsesStagingLocation(
  delivery: admin.firestore.DocumentData,
  locationId: string,
): boolean {
  if (delivery.stagingLocationId === locationId) return true;
  const extra = delivery.additionalStagingLocationIds;
  return Array.isArray(extra) && extra.includes(locationId);
}

async function assertStagingLocationAvailable(
  locationId: string,
  deliveryId: string,
): Promise<void> {
  const locSnap = await getDb().collection("stagingLocations").doc(locationId).get();
  if (!locSnap.exists) {
    throw new HttpsError("not-found", "Staging location not found.");
  }
  const occupiedSnap = await getDb()
    .collection("deliveries")
    .where("stagingLocationId", "==", locationId)
    .limit(5)
    .get();
  for (const doc of occupiedSnap.docs) {
    if (doc.id !== deliveryId) {
      throw new HttpsError(
        "failed-precondition",
        "Staging location is occupied by another delivery.",
      );
    }
  }
}

function plannedIds(delivery: admin.firestore.DocumentData): string[] {
  const raw = delivery.plannedStagingLocationIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function hasReleaseEntry(
  delivery: admin.firestore.DocumentData,
  locationId: string,
): boolean {
  const releases = delivery.plannedLocationReleases;
  if (!Array.isArray(releases)) return false;
  return releases.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      (entry as { locationId?: string }).locationId === locationId,
  );
}

export const releasePlannedStagingLocation = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as ReleasePlannedStagingRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const locationId = asStagingLocationId(data.locationId);
    const placed = asPlacedFlag(data.placed);

    if (!deliveryId || !sessionToken || !locationId) {
      throw new HttpsError("invalid-argument", "Invalid request.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }

    const delivery = deliverySnap.data() as admin.firestore.DocumentData;
    const status = String(delivery.status ?? "");
    if (status === "picked_up" || status === "installed") {
      throw new HttpsError("failed-precondition", "Delivery is no longer active.");
    }

    const planned = plannedIds(delivery);
    if (!planned.includes(locationId)) {
      throw new HttpsError(
        "failed-precondition",
        "Location is not a planned spot for this delivery.",
      );
    }

    if (hasReleaseEntry(delivery, locationId)) {
      return { deliveryId, locationId, placed, skipped: true };
    }

    const actualIds = getAllStagingLocationIds(delivery);
    if (actualIds.includes(locationId)) {
      return { deliveryId, locationId, placed: true, skipped: true };
    }

    const now = new Date().toISOString();

    if (placed) {
      if (!deliveryUsesStagingLocation(delivery, locationId)) {
        await assertStagingLocationAvailable(locationId, deliveryId);
      }
      if (!delivery.stagingLocationId || delivery.stagingLocationId === "") {
        await deliveryRef.update({
          stagingLocationId: locationId,
          updatedAt: now,
        });
      } else if (!actualIds.includes(locationId)) {
        await deliveryRef.update({
          additionalStagingLocationIds: FieldValue.arrayUnion(locationId),
          updatedAt: now,
        });
      }
      return { deliveryId, locationId, placed: true };
    }

    const releaseEntry = {
      locationId,
      releasedAt: now,
      releasedBy: "vendor",
      reason: "vendor_declined_planned_spot",
    };

    await deliveryRef.update({
      plannedStagingLocationIds: FieldValue.arrayRemove(locationId),
      plannedLocationReleases: FieldValue.arrayUnion(releaseEntry),
      updatedAt: now,
    });

    return { deliveryId, locationId, placed: false, released: true };
  },
);
