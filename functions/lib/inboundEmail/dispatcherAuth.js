"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasManagerRole = hasManagerRole;
exports.requireDispatcherAuth = requireDispatcherAuth;
exports.requireManagerAuth = requireManagerAuth;
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
async function readDispatcherRoleDoc(uid) {
    const roleSnap = await getDb()
        .collection(DISPATCHER_ROLES_COLLECTION)
        .doc(uid)
        .get();
    if (!roleSnap.exists)
        return null;
    return roleSnap.data();
}
async function hasDispatcherRole(uid) {
    const role = await readDispatcherRoleDoc(uid);
    if (role) {
        return role.active !== false;
    }
    try {
        const user = await admin.auth().getUser(uid);
        return user.customClaims?.dispatcher === true;
    }
    catch {
        return false;
    }
}
/** D-59 P2: manager flag on dispatcherRoles/{uid} — no customClaims.manager. */
async function hasManagerRole(uid) {
    const role = await readDispatcherRoleDoc(uid);
    if (!role || role.active === false)
        return false;
    return role.manager === true;
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
/** D-59 P2: signed-in dispatcher with manager === true on dispatcherRoles doc. */
async function requireManagerAuth(request) {
    const uid = await requireDispatcherAuth(request);
    if (!(await hasManagerRole(uid))) {
        throw new https_1.HttpsError("permission-denied", "Manager role required for this action.");
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