"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asManagementSessionToken = asManagementSessionToken;
exports.loadCatchAllConfig = loadCatchAllConfig;
exports.assertManagementCatchAllSession = assertManagementCatchAllSession;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const managementPinRegistry_1 = require("./managementPinRegistry");
function getDb() {
    return admin.firestore();
}
function asManagementSessionToken(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-f0-9]{64}$/.test(trimmed))
        return null;
    return trimmed;
}
async function loadSession(sessionToken) {
    const snap = await getDb()
        .collection("managementSessions")
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
async function loadCatchAllConfig() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    const catchAllStagingLocationId = data.catchAllStagingLocationId?.trim() ?? "";
    if (!catchAllStagingLocationId || data.parcelIntakeEnabled !== true) {
        return null;
    }
    return {
        catchAllStagingLocationId,
        parcelIntakeEnabled: true,
    };
}
/**
 * Validates management session when parcel intake is enabled (any location QR).
 * Registry is authority: re-reads pin active + capability on each call.
 */
async function assertManagementCatchAllSession(sessionToken, requiredCapability) {
    const session = await loadSession(sessionToken);
    if (!session) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    assertNotExpired(session);
    const config = await loadCatchAllConfig();
    if (!config) {
        throw new https_1.HttpsError("failed-precondition", "Catch-all parcel intake is not configured.");
    }
    const pinId = session.pinId?.trim();
    if (!pinId) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const pin = await (0, managementPinRegistry_1.loadManagementPinById)(pinId);
    if (!pin || pin.active !== true) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    if (requiredCapability &&
        !(0, managementPinRegistry_1.pinHasCapability)(pin, requiredCapability)) {
        throw new https_1.HttpsError("permission-denied", "This PIN is not allowed to perform that action.");
    }
    return session;
}
//# sourceMappingURL=managementSessionValidation.js.map