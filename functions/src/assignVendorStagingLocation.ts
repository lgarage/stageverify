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
import { assertStagingLocationAvailableInTransaction } from "./stagingOccupancyGuard";

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

    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);

    let response: {
      deliveryId: string;
      stagingLocationId: string | null;
      mode: AssignMode;
    } | null = null;

    await db.runTransaction(async (tx) => {
      const deliverySnap = await tx.get(deliveryRef);
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
          response = { deliveryId, stagingLocationId, mode };
          return;
        }
        await assertStagingLocationAvailableInTransaction(
          tx,
          db,
          stagingLocationId!,
          deliveryId,
        );
        tx.update(deliveryRef, {
          additionalStagingLocationIds: FieldValue.arrayUnion(stagingLocationId),
          updatedAt: now,
        });
        response = { deliveryId, stagingLocationId, mode };
        return;
      }

      if (stagingLocationId) {
        if (!deliveryUsesStagingLocation(delivery, stagingLocationId)) {
          await assertStagingLocationAvailableInTransaction(
            tx,
            db,
            stagingLocationId,
            deliveryId,
          );
        }
      }

      tx.update(deliveryRef, {
        stagingLocationId: stagingLocationId ?? "",
        updatedAt: now,
      });
      response = { deliveryId, stagingLocationId, mode };
    });

    if (!response) {
      throw new HttpsError("internal", "Staging assignment did not complete.");
    }
    return response;
  },
);
