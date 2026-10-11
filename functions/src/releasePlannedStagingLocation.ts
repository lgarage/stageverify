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
import { assertStagingLocationAvailableInTransaction } from "./stagingOccupancyGuard";

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

type ReleaseResponse =
  | { deliveryId: string; locationId: string; placed: boolean; skipped: true }
  | { deliveryId: string; locationId: string; placed: true; skipped?: undefined }
  | { deliveryId: string; locationId: string; placed: false; released: true };

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

    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);

    let response: ReleaseResponse | null = null;

    await db.runTransaction(async (tx) => {
      const deliverySnap = await tx.get(deliveryRef);
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
        response = { deliveryId, locationId, placed, skipped: true };
        return;
      }

      const actualIds = getAllStagingLocationIds(delivery);
      if (actualIds.includes(locationId)) {
        response = { deliveryId, locationId, placed: true, skipped: true };
        return;
      }

      const now = new Date().toISOString();

      if (placed) {
        if (!deliveryUsesStagingLocation(delivery, locationId)) {
          await assertStagingLocationAvailableInTransaction(
            tx,
            db,
            locationId,
            deliveryId,
          );
        }
        if (!delivery.stagingLocationId || delivery.stagingLocationId === "") {
          tx.update(deliveryRef, {
            stagingLocationId: locationId,
            updatedAt: now,
          });
        } else if (!actualIds.includes(locationId)) {
          tx.update(deliveryRef, {
            additionalStagingLocationIds: FieldValue.arrayUnion(locationId),
            updatedAt: now,
          });
        }
        response = { deliveryId, locationId, placed: true };
        return;
      }

      const releaseEntry = {
        locationId,
        releasedAt: now,
        releasedBy: "vendor",
        reason: "vendor_declined_planned_spot",
      };

      tx.update(deliveryRef, {
        plannedStagingLocationIds: FieldValue.arrayRemove(locationId),
        plannedLocationReleases: FieldValue.arrayUnion(releaseEntry),
        updatedAt: now,
      });

      response = { deliveryId, locationId, placed: false, released: true };
    });

    if (!response) {
      throw new HttpsError("internal", "Release planned staging did not complete.");
    }
    return response;
  },
);
