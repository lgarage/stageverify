"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PICKUP_TOKEN_DAYS = void 0;
exports.hashPickupToken = hashPickupToken;
exports.asPickupToken = asPickupToken;
exports.asJobId = asJobId;
exports.isPickupTokenActive = isPickupTokenActive;
const crypto_1 = require("crypto");
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
//# sourceMappingURL=pickupTokenValidation.js.map