import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

function getDb() {
  return admin.firestore();
}

interface GetLocationPublicBrandingRequest {
  locationCode?: string;
}

function asLocationCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return null;
  return trimmed;
}

/** Pre-PIN location header — non-sensitive branding only (Phase 3). */
export const getLocationPublicBranding = onCall(
  {
    region: "us-central1",
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const locationCode = asLocationCode(
      (request.data as GetLocationPublicBrandingRequest)?.locationCode,
    );
    if (!locationCode) {
      throw new HttpsError("invalid-argument", "Invalid location code.");
    }

    const snap = await getDb()
      .collection("stagingLocations")
      .where("code", "==", locationCode)
      .limit(1)
      .get();

    if (snap.empty) {
      return { found: false as const };
    }

    const doc = snap.docs[0];
    const data = doc.data();

    const settingsSnap = await getDb().collection("appSettings").doc("config").get();
    const settings = settingsSnap.data() as {
      catchAllStagingLocationId?: string;
      parcelIntakeEnabled?: boolean;
    } | undefined;
    const parcelIntakeEnabled = settings?.parcelIntakeEnabled === true;
    const isCatchAllParcelIntake =
      parcelIntakeEnabled &&
      settings?.catchAllStagingLocationId?.trim() === doc.id;

    return {
      found: true as const,
      locationId: doc.id,
      code: String(data.code ?? locationCode),
      label:
        typeof data.label === "string" && data.label.trim()
          ? data.label.trim()
          : locationCode,
      type:
        typeof data.type === "string" && data.type.trim()
          ? data.type.trim()
          : "other",
      parcelIntakeEnabled,
      isCatchAllParcelIntake,
    };
  },
);
