"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PICKUP_TOKEN_DAYS = void 0;
exports.hashPickupToken = hashPickupToken;
exports.asPickupToken = asPickupToken;
exports.asJobId = asJobId;
exports.isPickupTokenActive = isPickupTokenActive;
exports.verifyPickupTokenForJob = verifyPickupTokenForJob;
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
exports.DEFAULT_PICKUP_TOKEN_DAYS = 7;
function hashPickupToken(token) {
    return (0, crypto_1.createHash)("sha256").update(token).digest("hex");
}
function asPickupToken(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-f0-9]{64}$/.test(trimmed))
        return null;
    return trimmed;
}
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function isPickupTokenActive(doc, nowMs = Date.now()) {
    if (doc.revokedAt)
        return false;
    const expiresMs = Date.parse(doc.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs)
        return false;
    return true;
}
async function verifyPickupTokenForJob(db, token, jobId) {
    const tokenHash = hashPickupToken(token);
    const snap = await db.collection("pickupTokens").doc(tokenHash).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Invalid or expired pickup link.");
    }
    const data = snap.data();
    if (!isPickupTokenActive(data)) {
        throw new https_1.HttpsError("permission-denied", "Invalid or expired pickup link.");
    }
    if (data.jobId !== jobId) {
        throw new https_1.HttpsError("permission-denied", "Pickup link does not match this job.");
    }
}
//# sourceMappingURL=pickupTokenValidation.js.map