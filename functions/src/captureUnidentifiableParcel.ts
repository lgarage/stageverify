import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { decrementCatchAllPendingCount } from "./catchAllPendingCount";
import {
  asManagementSessionToken,
  assertManagementCatchAllSession,
} from "./managementSessionValidation";

function getDb() {
  return admin.firestore();
}

interface CaptureUnidentifiableParcelRequest {
  sessionToken?: string;
  vendorDescription?: string;
  parcelDescription?: string;
  jobId?: string;
}

function asShortText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function asOptionalJobId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

/** Explicit capture → flagged shell; never auto-created from weak signals (Phase 6 Slice A). */
export const captureUnidentifiableParcel = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as CaptureUnidentifiableParcelRequest;
    const sessionToken = asManagementSessionToken(data.sessionToken);
    const vendorDescription = asShortText(data.vendorDescription, 128);
    const parcelDescription = asShortText(data.parcelDescription, 512);
    const jobId = asOptionalJobId(data.jobId);

    if (!sessionToken || !vendorDescription || !parcelDescription) {
      throw new HttpsError("invalid-argument", "Vendor and parcel description required.");
    }

    const session = await assertManagementCatchAllSession(sessionToken);

    if (jobId) {
      const jobSnap = await getDb().collection("jobs").doc(jobId).get();
      if (!jobSnap.exists) {
        throw new HttpsError("not-found", "Job not found.");
      }
    }

    const now = new Date().toISOString();
    const deliveryId = `delivery-unid-${crypto.randomUUID().slice(0, 12)}`;
    const orderNumber = `UNID-${now.slice(0, 10).replace(/-/g, "")}-${deliveryId.slice(-6)}`;

    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);

    await deliveryRef.set({
      id: deliveryId,
      orderNumber,
      ...(jobId ? { jobId } : {}),
      vendorId: "vendor-unknown",
      vendorName: vendorDescription,
      deliveryDate: now.slice(0, 10),
      status: "pending",
      availabilityStatus: "expected",
      stagingLocationId: session.scannedStagingLocationId,
      scannedStagingLocationId: session.scannedStagingLocationId,
      scannedAt: now,
      notes: parcelDescription,
      reviewFlag: {
        flagged: true,
        reason: "Unidentifiable parcel at catch-all intake",
        flaggedBy: "management",
        flaggedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    const logId = `catch-all-flag-${crypto.randomUUID().slice(0, 12)}`;
    await getDb().collection("pinVerificationEvents").doc(logId).set({
      id: logId,
      action: "CATCH_ALL_UNIDENTIFIABLE_PARCEL",
      deliveryId,
      timestamp: now,
      createdAt: now,
      stagingLocationCode: session.scannedStagingLocationCode,
    });

    await decrementCatchAllPendingCount(getDb());

    return {
      deliveryId,
      orderNumber,
      reviewFlagged: true,
    };
  },
);
