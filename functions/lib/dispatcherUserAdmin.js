"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateDispatcher = exports.provisionDispatcher = exports.listDispatchers = void 0;
/**
 * Manager-only dispatcher account provisioning (D-60).
 * Admin SDK creates Auth users + dispatcherRoles docs — no client writes.
 */
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";
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
/** Manager lists all dispatcher role registry entries. */
exports.listDispatchers = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const snap = await getDb().collection(DISPATCHER_ROLES_COLLECTION).get();
    const dispatchers = [];
    for (const roleDoc of snap.docs) {
        const data = roleDoc.data();
        let email = data.email ?? null;
        if (!email) {
            try {
                const user = await admin.auth().getUser(roleDoc.id);
                email = user.email ?? null;
            }
            catch {
                email = null;
            }
        }
        dispatchers.push({
            uid: roleDoc.id,
            email,
            active: data.active !== false,
            manager: data.manager === true,
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
        });
    }
    dispatchers.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
    return { dispatchers };
});
/** Manager creates Firebase Auth user + dispatcherRoles doc. */
exports.provisionDispatcher = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const email = normalizeEmail(data.email);
    const grantManager = data.manager === true;
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
        active: true,
        email,
        manager: grantManager,
        updatedAt: now,
        createdAt: now,
        createdBy: request.auth?.uid ?? null,
    }, { merge: true });
    return {
        success: true,
        uid,
        email,
        temporaryPassword: tempPassword,
        manager: grantManager,
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
    return { success: true };
});
//# sourceMappingURL=dispatcherUserAdmin.js.map