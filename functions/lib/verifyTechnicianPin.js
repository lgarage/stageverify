"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTechnicianPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const locationScanPinShared_1 = require("./locationScanPinShared");
exports.verifyTechnicianPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const pin = (0, locationScanPinShared_1.asAccessPin)(data.pin);
    const stagingLocationCode = (0, locationScanPinShared_1.asStagingLocationCode)(data.stagingLocationCode);
    if (!pin || !stagingLocationCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid code.");
    }
    const attemptKey = `loc:${stagingLocationCode}`;
    await (0, locationScanPinShared_1.checkPinRateLimit)("technicianPinAttempts", attemptKey);
    await (0, locationScanPinShared_1.checkPinRateLimit)("technicianPinAttempts", "pin:technician:global");
    const match = await (0, locationScanPinShared_1.findTechnicianByPin)(pin);
    if (!match) {
        return { success: false, message: "Invalid code." };
    }
    const location = await (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode);
    const technicianName = match.data.name?.trim() || "Technician";
    const session = await (0, locationScanPinShared_1.mintTechnicianSession)({
        technicianId: match.id,
        technicianName,
        stagingLocationCode,
        resolvedLocation: location,
    });
    await (0, locationScanPinShared_1.clearPinRateLimit)("technicianPinAttempts", attemptKey);
    await (0, locationScanPinShared_1.clearPinRateLimit)("technicianPinAttempts", "pin:technician:global");
    return {
        success: true,
        technicianId: match.id,
        technicianName,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
        scannedStagingLocationCode: session.scannedStagingLocationCode,
    };
});
//# sourceMappingURL=verifyTechnicianPin.js.map