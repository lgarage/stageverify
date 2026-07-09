import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  asDeliveryId,
  asSessionToken,
  assertVendorSessionForDelivery,
} from "./vendorSessionValidation";

function getDb() {
  return admin.firestore();
}

interface RecordVendorLocationScanRequest {
  deliveryId?: string;
  sessionToken?: string;
}

/** Writes scannedStagingLocationId + scannedAt on a job-scoped vendor check-in. */
export const recordVendorLocationScan = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as RecordVendorLocationScanRequest;
    const deliveryId = asDeliveryId(data.deliveryId);
    const sessionToken = asSessionToken(data.sessionToken);

    if (!deliveryId || !sessionToken) {
      throw new HttpsError("invalid-argument", "Invalid session.");
    }

    const session = await assertVendorSessionForDelivery(
      sessionToken,
      deliveryId,
    );
    const scannedLocationId = session.scannedStagingLocationId;
    if (!scannedLocationId) {
      return { ok: true as const, recorded: false as const };
    }

    const now = new Date().toISOString();
    await getDb().collection("deliveries").doc(deliveryId).update({
      scannedStagingLocationId: scannedLocationId,
      scannedAt: now,
      updatedAt: now,
    });

    return { ok: true as const, recorded: true as const };
  },
);
