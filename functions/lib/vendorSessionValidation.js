"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asSessionToken = asSessionToken;
exports.asDeliveryId = asDeliveryId;
exports.assertVendorSessionValid = assertVendorSessionValid;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
function asSessionToken(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-f0-9]{64}$/.test(trimmed))
        return null;
    return trimmed;
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
/** Validates opaque vendor session token is active and bound to deliveryId. */
async function assertVendorSessionValid(sessionToken, deliveryId) {
    const snap = await getDb()
        .collection("vendorSessions")
        .doc(sessionToken)
        .get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const session = snap.data();
    if (session.deliveryId !== deliveryId) {
        throw new https_1.HttpsError("permission-denied", "Session is not valid for this delivery.");
    }
    const expiresMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    return session;
}
//# sourceMappingURL=vendorSessionValidation.js.map