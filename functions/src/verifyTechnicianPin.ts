import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import {
  asAccessPin,
  asStagingLocationCode,
  checkPinRateLimit,
  clearPinRateLimit,
  findTechnicianByPin,
  mintTechnicianSession,
  resolveStagingLocation,
} from "./locationScanPinShared";

export const verifyTechnicianPin = onCall(
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

    const attemptKey = `loc:${stagingLocationCode}`;
    await checkPinRateLimit("technicianPinAttempts", attemptKey);
    await checkPinRateLimit("technicianPinAttempts", "pin:technician:global");

    const match = await findTechnicianByPin(pin);
    if (!match) {
      return { success: false, message: "Invalid code." };
    }

    const location = await resolveStagingLocation(stagingLocationCode);
    const technicianName = match.data.name?.trim() || "Technician";
    const session = await mintTechnicianSession({
      technicianId: match.id,
      technicianName,
      stagingLocationCode,
      resolvedLocation: location,
    });

    await clearPinRateLimit("technicianPinAttempts", attemptKey);
    await clearPinRateLimit("technicianPinAttempts", "pin:technician:global");

    return {
      success: true,
      technicianId: match.id,
      technicianName,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      scannedStagingLocationCode: session.scannedStagingLocationCode,
    };
  },
);
