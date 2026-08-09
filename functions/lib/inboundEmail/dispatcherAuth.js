"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDispatcherRoleDoc = readDispatcherRoleDoc;
exports.resolveDispatcherAccessRole = resolveDispatcherAccessRole;
exports.managerFlagForRole = managerFlagForRole;
exports.hasManagerRole = hasManagerRole;
exports.hasAdminRole = hasAdminRole;
exports.requireDispatcherAuth = requireDispatcherAuth;
exports.requireManagerAuth = requireManagerAuth;
exports.requireAdminAuth = requireAdminAuth;
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
/** Resolve canonical role from role field + legacy manager boolean. */
function resolveDispatcherAccessRole(data) {
    if (!data)
        return "dispatcher";
    if (data.role === "admin")
        return "admin";
    if (data.role === "manager")
        return "manager";
    if (data.role === "dispatcher")
        return "dispatcher";
    // Legacy: manager flag only
    if (data.manager === true)
        return "manager";
    return "dispatcher";
}
function managerFlagForRole(role) {
    return role === "admin" || role === "manager";
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
/** D-59 P2: manager flag on dispatcherRoles/{uid} — no customClaims.manager.
 * Admin also satisfies manager-level ops (synced manager flag + role SSOT). */
async function hasManagerRole(uid) {
    const role = await readDispatcherRoleDoc(uid);
    if (!role || role.active === false || role.removed === true)
        return false;
    const accessRole = resolveDispatcherAccessRole(role);
    return managerFlagForRole(accessRole) || role.manager === true;
}
/** Active named Admin — role SSOT only (not manager flag alone). */
async function hasAdminRole(uid) {
    const role = await readDispatcherRoleDoc(uid);
    if (!role || role.active === false || role.removed === true)
        return false;
    return resolveDispatcherAccessRole(role) === "admin";
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
/** Signed-in active Admin (named person) — required for privileged PIN reveal. */
async function requireAdminAuth(request) {
    const uid = await requireDispatcherAuth(request);
    if (!(await hasAdminRole(uid))) {
        throw new https_1.HttpsError("permission-denied", "Admin role required for this action.");
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