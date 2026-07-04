/**
 * Vendor staging assignment — session-gated replacement for unauth Firestore staging writes.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionValid,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

type AssignMode = "primary" | "additional";

interface AssignVendorStagingRequest {
  deliveryId?: string;
  sessionToken?: string;
  stagingLocationId?: string;
  mode?: string;
}

function asStagingLocationId(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function asAssignMode(value: unknown): AssignMode {
  return value === "additional" ? "additional" : "primary";
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

export const assignVendorStagingLocation = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as AssignVendorStagingRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);
    const stagingLocationId = asStagingLocationId(data.stagingLocationId);
    const mode = asAssignMode(data.mode);

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }
    if (mode === "primary" && stagingLocationId === null && data.stagingLocationId !== null && data.stagingLocationId !== "") {
      throw new HttpsError("invalid-argument", "Invalid staging location.");
    }
    if (mode === "additional" && !stagingLocationId) {
      throw new HttpsError("invalid-argument", "stagingLocationId is required.");
    }

    await assertVendorSessionValid(sessionToken, deliveryId);

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
      throw new HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data() as admin.firestore.DocumentData;
    const status = delivery.status as string;
    if (status === "picked_up" || status === "installed") {
      throw new HttpsError("failed-precondition", "Delivery is no longer active.");
    }

    const now = new Date().toISOString();

    if (mode === "additional") {
      if (deliveryUsesStagingLocation(delivery, stagingLocationId!)) {
        return { deliveryId, stagingLocationId, mode };
      }
      await assertStagingLocationAvailable(stagingLocationId!, deliveryId);
      await deliveryRef.update({
        additionalStagingLocationIds: FieldValue.arrayUnion(stagingLocationId),
        updatedAt: now,
      });
      return { deliveryId, stagingLocationId, mode };
    }

    if (stagingLocationId) {
      if (!deliveryUsesStagingLocation(delivery, stagingLocationId)) {
        await assertStagingLocationAvailable(stagingLocationId, deliveryId);
      }
    }

    await deliveryRef.update({
      stagingLocationId: stagingLocationId ?? "",
      updatedAt: now,
    });

    return { deliveryId, stagingLocationId, mode };
  },
);
