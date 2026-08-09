"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDispatcher = exports.deactivateDispatcher = exports.updateDispatcherAccess = exports.provisionDispatcher = exports.listDispatchers = void 0;
/**
 * Manager/Admin dispatcher account provisioning (D-60).
 * Admin SDK creates Auth users + dispatcherRoles docs — no client writes.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const adminPinSecret_1 = require("./adminPinSecret");
const humanAccessIdentity_1 = require("./humanAccessIdentity");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";
/** Hard-blocked from permanent removal (ops / primary test identities). */
const PROTECTED_DISPATCHER_EMAILS = new Set([
    "daday1974@gmail.com",
    "[REDACTED]", // pragma: allowlist secret — ops allowlist, not a credential
]);
function getDb() {
    return admin.firestore();
}
function normalizeEmail(raw) {
    if (typeof raw !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Email is required.");
    }
    const email = raw.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new https_1.HttpsError("invalid-argument", "Please enter a valid email address.");
    }
    return email;
}
function generateTemporaryPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = (0, crypto_1.randomBytes)(16);
    let out = "";
    for (let i = 0; i < 16; i += 1) {
        out += chars[bytes[i] % chars.length];
    }
    return out;
}
async function actorFullName(uid) {
    const snap = await getDb()
        .collection(DISPATCHER_ROLES_COLLECTION)
        .doc(uid)
        .get();
    const data = snap.data();
    return typeof data?.fullName === "string" ? data.fullName : undefined;
}
/**
 * Escalating to Admin requires an active Admin caller, OR zero-Admin bootstrap
 * by an active Manager (first Admin only).
 */
async function assertCanGrantAdminRole(callerUid) {
    if (await (0, dispatcherAuth_1.hasAdminRole)(callerUid))
        return;
    const activeAdmins = await (0, humanAccessIdentity_1.countActiveAdmins)();
    if (activeAdmins === 0) {
        // Zero-Admin bootstrap: any Manager (including legacy manager flag) may create first Admin.
        return;
    }
    throw new https_1.HttpsError("permission-denied", "Only an Admin can grant the Admin role.");
}
/** Manager lists all dispatcher role registry entries. */
exports.listDispatchers = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const snap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).get();
    const dispatchers = [];
    for (const roleDoc of snap.docs) {
        const data = roleDoc.data();
        if (data.removed === true)
            continue;
        let email = typeof data.email === "string" ? data.email : null;
        if (!email) {
            try {
                const user = await admin.auth().getUser(roleDoc.id);
                email = user.email ?? null;
            }
            catch {
                email = null;
            }
        }
        const role = (0, dispatcherAuth_1.resolveDispatcherAccessRole)(data);
        dispatchers.push({
            uid: roleDoc.id,
            email,
            fullName: typeof data.fullName === "string" ? data.fullName : null,
            active: data.active !== false,
            manager: role === "admin" || role === "manager",
            role,
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
        });
    }
    dispatchers.sort((a, b) => {
        const aKey = (a.fullName ?? a.email ?? a.uid).toLowerCase();
        const bKey = (b.fullName ?? b.email ?? b.uid).toLowerCase();
        return aKey.localeCompare(bKey);
    });
    return { dispatchers };
});
/** Manager creates Firebase Auth user + dispatcherRoles doc. */
exports.provisionDispatcher = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const callerUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const email = normalizeEmail(data.email);
    const fullName = (0, humanAccessIdentity_1.validateHumanFullName)(data.fullName);
    let role = (0, humanAccessIdentity_1.parseDispatcherAccessRole)(data.role);
    if (!role) {
        role = data.manager === true ? "manager" : "dispatcher";
    }
    if (role === "admin") {
        await assertCanGrantAdminRole(callerUid);
        if (!(0, adminPinSecret_1.asAdminPin)(data.adminPin)) {
            throw new https_1.HttpsError("invalid-argument", "Admin PIN must be exactly 6 digits.");
        }
    }
    const tempPassword = typeof data.temporaryPassword === "string" &&
        data.temporaryPassword.length >= 8
        ? data.temporaryPassword
        : generateTemporaryPassword();
    let uid;
    try {
        const created = await admin.auth().createUser({
            email,
            password: tempPassword,
            emailVerified: false,
            displayName: fullName,
        });
        uid = created.uid;
    }
    catch (err) {
        const code = err instanceof Error && "code" in err
            ? String(err.code)
            : "";
        if (code === "auth/email-already-exists") {
            throw new https_1.HttpsError("failed-precondition", "An account with that email could not be created. Contact support if unexpected.");
        }
        throw new https_1.HttpsError("internal", "Could not create dispatcher account. Please try again.");
    }
    const now = new Date().toISOString();
    await getDb()
        .collection(DISPATCHER_ROLES_COLLECTION)
        .doc(uid)
        .set({
        ...(0, humanAccessIdentity_1.rolePatch)(role, {
            active: true,
            email,
            fullName,
            updatedAt: now,
            createdAt: now,
            createdBy: callerUid,
        }),
    }, { merge: true });
    if (role === "admin") {
        await (0, adminPinSecret_1.setOwnAdminPin)(uid, data.adminPin);
        const callerName = await actorFullName(callerUid);
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_created",
            targetType: "dispatcher",
            targetId: uid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_pin_set",
            targetType: "dispatcher",
            targetId: uid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
    }
    return {
        success: true,
        uid,
        email,
        fullName,
        temporaryPassword: tempPassword,
        manager: role === "admin" || role === "manager",
        role,
    };
});
/**
 * Update named identity fields / role on an existing Auth human (same uid).
 * Manager→Admin preserves identity; Admin→Manager strips Admin PIN secret.
 */
exports.updateDispatcherAccess = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const callerUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const targetUid = typeof data.uid === "string" ? data.uid.trim() : "";
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "Dispatcher uid is required.");
    }
    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Dispatcher account not found.");
    }
    const existing = roleSnap.data();
    if (existing.removed === true) {
        throw new https_1.HttpsError("failed-precondition", "Account already removed.");
    }
    const prevRole = (0, dispatcherAuth_1.resolveDispatcherAccessRole)(existing);
    const nextRole = (0, humanAccessIdentity_1.parseDispatcherAccessRole)(data.role) ?? prevRole;
    const patch = {
        updatedAt: new Date().toISOString(),
        updatedBy: callerUid,
    };
    if (data.fullName !== undefined) {
        patch.fullName = (0, humanAccessIdentity_1.validateHumanFullName)(data.fullName);
    }
    if (nextRole !== prevRole) {
        if (nextRole === "admin") {
            await assertCanGrantAdminRole(callerUid);
            if (!(0, adminPinSecret_1.asAdminPin)(data.adminPin)) {
                throw new https_1.HttpsError("invalid-argument", "Admin PIN must be exactly 6 digits when granting Admin.");
            }
        }
        if (prevRole === "admin" && nextRole !== "admin") {
            await (0, humanAccessIdentity_1.assertNotLastActiveAdmin)(targetUid, existing);
            // Only Admins may demote Admins (except self-bootstrap edge: last admin blocked above).
            if (!(await (0, dispatcherAuth_1.hasAdminRole)(callerUid))) {
                throw new https_1.HttpsError("permission-denied", "Only an Admin can change an Admin's role.");
            }
        }
        Object.assign(patch, (0, humanAccessIdentity_1.rolePatch)(nextRole));
    }
    await roleRef.set(patch, { merge: true });
    const callerName = await actorFullName(callerUid);
    if (prevRole !== "admin" && nextRole === "admin") {
        await (0, adminPinSecret_1.setOwnAdminPin)(targetUid, data.adminPin);
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "role_changed_to_admin",
            targetType: "dispatcher",
            targetId: targetUid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_pin_set",
            targetType: "dispatcher",
            targetId: targetUid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
    }
    if (prevRole === "admin" && nextRole !== "admin") {
        await (0, adminPinSecret_1.clearOwnAdminPin)(targetUid);
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "role_changed_from_admin",
            targetType: "dispatcher",
            targetId: targetUid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
    }
    return {
        success: true,
        uid: targetUid,
        role: nextRole,
        fullName: typeof patch.fullName === "string"
            ? patch.fullName
            : (existing.fullName ?? null),
    };
});
/** Manager deactivates a dispatcher (role + Auth disable). */
exports.deactivateDispatcher = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const callerUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const uid = request.data?.uid;
    if (typeof uid !== "string" || !uid.trim()) {
        throw new https_1.HttpsError("invalid-argument", "Dispatcher uid is required.");
    }
    if (uid === callerUid) {
        throw new https_1.HttpsError("failed-precondition", "You cannot deactivate your own dispatcher account.");
    }
    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(uid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Dispatcher account not found.");
    }
    const roleData = roleSnap.data();
    await (0, humanAccessIdentity_1.assertNotLastActiveAdmin)(uid, roleData);
    await roleRef.set({
        active: false,
        updatedAt: new Date().toISOString(),
        deactivatedBy: callerUid,
    }, { merge: true });
    try {
        await admin.auth().updateUser(uid, { disabled: true });
    }
    catch (err) {
        const code = err instanceof Error && "code" in err
            ? String(err.code)
            : "";
        if (code !== "auth/user-not-found") {
            throw new https_1.HttpsError("internal", "Role deactivated but Auth disable failed. Retry or contact support.");
        }
    }
    if ((0, dispatcherAuth_1.resolveDispatcherAccessRole)(roleData) === "admin") {
        const callerName = await actorFullName(callerUid);
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_deactivated",
            targetType: "dispatcher",
            targetId: uid,
            actorUid: callerUid,
            actorFullName: callerName,
        });
    }
    return { success: true };
});
/**
 * Manager permanently removes an already-inactive dispatcher access identity.
 * Deletes Firebase Auth user; tombstones dispatcherRoles (preserves history);
 * writes pinAccessAudit dispatcher_removed. Never client-writable.
 */
exports.removeDispatcher = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const callerUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const uid = request.data?.uid;
    if (typeof uid !== "string" || !uid.trim()) {
        throw new https_1.HttpsError("invalid-argument", "Dispatcher uid is required.");
    }
    const targetUid = uid.trim();
    const roleRef = getDb().collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Dispatcher account not found.");
    }
    const roleData = roleSnap.data();
    const roleEmail = typeof roleData.email === "string"
        ? roleData.email.trim().toLowerCase()
        : "";
    let authEmail = "";
    try {
        const authUser = await admin.auth().getUser(targetUid);
        authEmail =
            typeof authUser.email === "string"
                ? authUser.email.trim().toLowerCase()
                : "";
    }
    catch (err) {
        const code = err instanceof Error && "code" in err
            ? String(err.code)
            : "";
        if (code !== "auth/user-not-found") {
            throw new https_1.HttpsError("internal", "Could not resolve Auth identity for removal checks.");
        }
    }
    if ((roleEmail && PROTECTED_DISPATCHER_EMAILS.has(roleEmail)) ||
        (authEmail && PROTECTED_DISPATCHER_EMAILS.has(authEmail))) {
        throw new https_1.HttpsError("failed-precondition", "This account cannot be removed.");
    }
    if (targetUid === callerUid) {
        throw new https_1.HttpsError("failed-precondition", "You cannot remove your own dispatcher account.");
    }
    if (roleData.removed === true) {
        throw new https_1.HttpsError("failed-precondition", "Account already removed.");
    }
    if (roleData.active !== false) {
        throw new https_1.HttpsError("failed-precondition", "Deactivate this account before removing it.");
    }
    try {
        await admin.auth().deleteUser(targetUid);
    }
    catch (err) {
        const code = err instanceof Error && "code" in err
            ? String(err.code)
            : "";
        if (code !== "auth/user-not-found") {
            throw new https_1.HttpsError("internal", "Auth identity could not be removed. Retry or contact support.");
        }
    }
    const now = new Date().toISOString();
    await roleRef.set({
        active: false,
        removed: true,
        removedAt: now,
        removedBy: callerUid,
        updatedAt: now,
    }, { merge: true });
    await (0, adminPinSecret_1.clearOwnAdminPin)(targetUid).catch(() => undefined);
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "dispatcher_removed",
        targetType: "dispatcher",
        targetId: targetUid,
        actorUid: callerUid,
    });
    return { success: true, uid: targetUid };
});
//# sourceMappingURL=dispatcherUserAdmin.js.map