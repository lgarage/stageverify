"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyManagementPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const managementSessionValidation_1 = require("./managementSessionValidation");
const managementPinRegistry_1 = require("./managementPinRegistry");
const locationScanPinShared_1 = require("./locationScanPinShared");
exports.verifyManagementPin = (0, https_1.onCall)({
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
    // Office portal remains catch-all-gated (parcelIntakeEnabled required).
    const config = await (0, managementSessionValidation_1.loadCatchAllConfig)();
    if (!config) {
        throw new https_1.HttpsError("failed-precondition", "Catch-all parcel intake is not enabled.");
    }
    const location = await (0, locationScanPinShared_1.resolveStagingLocation)(stagingLocationCode);
    if (!location) {
        throw new https_1.HttpsError("failed-precondition", "Unknown staging location.");
    }
    const attemptKey = `loc:${stagingLocationCode}`;
    await (0, locationScanPinShared_1.checkPinRateLimit)("managementPinAttempts", attemptKey);
    await (0, locationScanPinShared_1.checkPinRateLimit)("managementPinAttempts", "pin:management:global");
    const matched = await (0, managementPinRegistry_1.resolveManagementPinMatch)(pin);
    if (!matched) {
        return { success: false, message: "Invalid code." };
    }
    if (!(0, managementPinRegistry_1.pinHasCapability)(matched, "enterPortalAnyQr")) {
        return {
            success: false,
            message: "This PIN cannot open the office portal.",
        };
    }
    const session = await (0, locationScanPinShared_1.mintManagementSession)({
        location,
        pinId: matched.id,
        permissions: matched.permissions,
    });
    await (0, locationScanPinShared_1.clearPinRateLimit)("managementPinAttempts", attemptKey);
    await (0, locationScanPinShared_1.clearPinRateLimit)("managementPinAttempts", "pin:management:global");
    return {
        success: true,
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
        scannedStagingLocationCode: session.scannedStagingLocationCode,
        pinId: matched.id,
        permissions: matched.permissions,
    };
});
//# sourceMappingURL=verifyManagementPin.js.map