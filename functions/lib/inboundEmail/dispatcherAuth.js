"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDispatcherAuth = requireDispatcherAuth;
exports.clampListLimit = clampListLimit;
/**
 * Dispatcher-only callable auth — signed-in Firebase user with dispatcher role.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";
function getDb() {
    return admin.firestore();
}
async function hasDispatcherRole(uid) {
    const roleSnap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(uid).get();
    if (roleSnap.exists) {
        const active = roleSnap.data().active;
        return active !== false;
    }
    try {
        const user = await admin.auth().getUser(uid);
        return user.customClaims?.dispatcher === true;
    }
    catch {
        return false;
    }
}
async function requireDispatcherAuth(request) {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("permission-denied", "Sign in as a dispatcher to use this feature.");
    }
    const uid = request.auth.uid;
    if (!(await hasDispatcherRole(uid))) {
        throw new https_1.HttpsError("permission-denied", "Dispatcher role required for this feature.");
    }
    return uid;
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