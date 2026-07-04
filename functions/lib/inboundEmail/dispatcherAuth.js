"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDispatcherAuth = requireDispatcherAuth;
exports.clampListLimit = clampListLimit;
/**
 * Dispatcher-only callable auth — any signed-in Firebase user (not vendor PIN session).
 */
const https_1 = require("firebase-functions/v2/https");
function requireDispatcherAuth(request) {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("permission-denied", "Sign in as a dispatcher to use this feature.");
    }
    return request.auth.uid;
}
/** Clamp list limit to [1, max] with Math.floor — rejects NaN and non-finite. */
function clampListLimit(raw, defaultLimit, maxLimit) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return defaultLimit;
    }
    const floored = Math.floor(raw);
    if (floored < 1)
        return defaultLimit;
    if (floored > maxLimit)
        return maxLimit;
    return floored;
}
//# sourceMappingURL=dispatcherAuth.js.map