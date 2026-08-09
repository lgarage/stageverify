import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import { loadCatchAllConfig } from "./managementSessionValidation";
import {
  pinHasCapability,
  resolveManagementPinMatch,
} from "./managementPinRegistry";
import {
  asAccessPin,
  asStagingLocationCode,
  checkPinRateLimit,
  clearPinRateLimit,
  mintManagementSession,
  resolveStagingLocation,
} from "./locationScanPinShared";

export const verifyManagementPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
    cors: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://lgarage.github.io",
    ],
  },
  async (request) => {
    const data = (request.data ?? {}) as {
      pin?: string;
      stagingLocationCode?: string;
    };
    const pin = asAccessPin(data.pin);
    const stagingLocationCode = asStagingLocationCode(data.stagingLocationCode);

    if (!pin || !stagingLocationCode) {
      throw new HttpsError("invalid-argument", "Invalid code.");
    }

    // Office portal remains catch-all-gated (parcelIntakeEnabled required).
    const config = await loadCatchAllConfig();
    if (!config) {
      throw new HttpsError(
        "failed-precondition",
        "Catch-all parcel intake is not enabled.",
      );
    }

    const location = await resolveStagingLocation(stagingLocationCode);
    if (!location) {
      throw new HttpsError(
        "failed-precondition",
        "Unknown staging location.",
      );
    }

    const attemptKey = `loc:${stagingLocationCode}`;
    await checkPinRateLimit("managementPinAttempts", attemptKey);
    await checkPinRateLimit("managementPinAttempts", "pin:management:global");

    const matched = await resolveManagementPinMatch(pin);
    if (!matched) {
      return { success: false, message: "Invalid code." };
    }

    if (!pinHasCapability(matched, "enterPortalAnyQr")) {
      return {
        success: false,
        message: "This PIN cannot open the office portal.",
      };
    }

    const session = await mintManagementSession({
      location,
      pinId: matched.id,
      permissions: matched.permissions,
    });

    await clearPinRateLimit("managementPinAttempts", attemptKey);
    await clearPinRateLimit("managementPinAttempts", "pin:management:global");

    return {
      success: true,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      scannedStagingLocationCode: session.scannedStagingLocationCode,
      pinId: matched.id,
      permissions: matched.permissions,
    };
  },
);
