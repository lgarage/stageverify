"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asSessionToken = asSessionToken;
exports.asDeliveryId = asDeliveryId;
exports.assertVendorSessionValid = assertVendorSessionValid;
exports.assertVendorSessionForDelivery = assertVendorSessionForDelivery;
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
async function loadSession(sessionToken) {
    const snap = await getDb()
        .collection("vendorSessions")
        .doc(sessionToken)
        .get();
    if (!snap.exists)
        return null;
    return snap.data();
}
function assertNotExpired(session) {
    const expiresMs = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
}
/** Validates opaque vendor session token is active and bound to deliveryId. */
async function assertVendorSessionValid(sessionToken, deliveryId) {
    return assertVendorSessionForDelivery(sessionToken, deliveryId);
}
/** Job-scoped or delivery-scoped session check for a specific delivery. */
async function assertVendorSessionForDelivery(sessionToken, deliveryId) {
    const session = await loadSession(sessionToken);
    if (!session) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    assertNotExpired(session);
    if (session.sessionScope === "job" && session.jobId) {
        const deliverySnap = await getDb()
            .collection("deliveries")
            .doc(deliveryId)
            .get();
        if (!deliverySnap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const deliveryJobId = String(deliverySnap.data()?.jobId ?? "");
        if (deliveryJobId !== session.jobId) {
            throw new https_1.HttpsError("permission-denied", "Session is not valid for this delivery.");
        }
        return session;
    }
    if (session.deliveryId !== deliveryId) {
        throw new https_1.HttpsError("permission-denied", "Session is not valid for this delivery.");
    }
    return session;
}
//# sourceMappingURL=vendorSessionValidation.js.map