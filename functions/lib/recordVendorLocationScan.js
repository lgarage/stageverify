"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordVendorLocationScan = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
/** Writes scannedStagingLocationId + scannedAt on a job-scoped vendor check-in. */
exports.recordVendorLocationScan = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.deliveryId);
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await (0, vendorSessionValidation_1.assertVendorSessionForDelivery)(sessionToken, deliveryId);
    const scannedLocationId = session.scannedStagingLocationId;
    if (!scannedLocationId) {
        return { ok: true, recorded: false };
    }
    const now = new Date().toISOString();
    await getDb().collection("deliveries").doc(deliveryId).update({
        scannedStagingLocationId: scannedLocationId,
        scannedAt: now,
        updatedAt: now,
    });
    return { ok: true, recorded: true };
});
//# sourceMappingURL=recordVendorLocationScan.js.map