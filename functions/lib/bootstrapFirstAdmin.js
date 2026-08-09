"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapFirstAdmin = void 0;
exports.runBootstrapFirstAdminTransaction = runBootstrapFirstAdminTransaction;
/**
 * Atomic first-Admin bootstrap — Manager-only, zero-Admin window only.
 * Uses Firestore transaction on lock + roles + admin secret so two Managers
 * cannot both succeed.
 */
const https_1 = require("firebase-functions/v2/https");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const adminPinSecret_1 = require("./adminPinSecret");
const humanAccessIdentity_1 = require("./humanAccessIdentity");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const DISPATCHER_ROLES_COLLECTION = "dispatcherRoles";
function countActiveAdminsInDocs(docs) {
    let count = 0;
    for (const doc of docs) {
        const data = doc.data();
        if (data.removed === true)
            continue;
        if (data.active === false)
            continue;
        if ((0, humanAccessIdentity_1.resolveDispatcherAccessRole)(data) === "admin")
            count += 1;
    }
    return count;
}
/**
 * Core transactional bootstrap — exported for emulator concurrency tests.
 * Binds target uid + fullName + role=admin + Admin PIN atomically with lock.
 */
async function runBootstrapFirstAdminTransaction(input) {
    const pin = (0, adminPinSecret_1.asAdminPin)(input.adminPin);
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "Admin PIN must be exactly 6 digits.");
    }
    const fullName = (0, humanAccessIdentity_1.validateHumanFullName)(input.fullName);
    const targetUid = input.targetUid.trim();
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "Target uid is required.");
    }
    const db = (0, accessPinSecretsShared_1.getDb)();
    const lockRef = db
        .collection(accessPinSecretsShared_1.ACCESS_CONTROL_LOCKS_COLLECTION)
        .doc(accessPinSecretsShared_1.FIRST_ADMIN_BOOTSTRAP_LOCK_ID);
    const roleRef = db.collection(DISPATCHER_ROLES_COLLECTION).doc(targetUid);
    const secretRef = db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc((0, adminPinSecret_1.adminPinSecretDocId)(targetUid));
    const now = new Date().toISOString();
    const secretDoc = (0, adminPinSecret_1.buildAdminPinSecretDoc)(targetUid, pin, now);
    await db.runTransaction(async (tx) => {
        const lockSnap = await tx.get(lockRef);
        if (lockSnap.exists) {
            throw new https_1.HttpsError("failed-precondition", "First Admin has already been bootstrapped.");
        }
        const rolesSnap = await tx.get(db.collection(DISPATCHER_ROLES_COLLECTION));
        if (countActiveAdminsInDocs(rolesSnap.docs) > 0) {
            throw new https_1.HttpsError("failed-precondition", "An active Admin already exists. Use Admin authorization to grant Admin.");
        }
        const roleSnap = await tx.get(roleRef);
        if (!roleSnap.exists) {
            throw new https_1.HttpsError("not-found", "Target access identity not found.");
        }
        const existing = roleSnap.data();
        if (existing.removed === true) {
            throw new https_1.HttpsError("failed-precondition", "Account already removed.");
        }
        if (existing.active === false) {
            throw new https_1.HttpsError("failed-precondition", "Target account must be active to become the first Admin.");
        }
        const lockDoc = {
            claimed: true,
            adminUid: targetUid,
            adminFullName: fullName,
            claimedByUid: input.callerUid,
            claimedAt: now,
        };
        tx.set(lockRef, lockDoc);
        tx.set(roleRef, {
            ...(0, humanAccessIdentity_1.rolePatch)("admin", {
                fullName,
                active: true,
                updatedAt: now,
                bootstrappedAsAdminAt: now,
                bootstrappedAsAdminBy: input.callerUid,
            }),
        }, { merge: true });
        tx.set(secretRef, secretDoc);
    });
    return {
        success: true,
        uid: targetUid,
        fullName,
        role: "admin",
    };
}
/**
 * Manager bootstraps the first named Admin while zero active Admins exist.
 * Not a permanent Manager→Admin escalation path — lock + active-Admin count
 * permanently close this window after the first success.
 */
exports.bootstrapFirstAdmin = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const callerUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const targetUid = typeof data.uid === "string" && data.uid.trim()
        ? data.uid.trim()
        : callerUid;
    const result = await runBootstrapFirstAdminTransaction({
        callerUid,
        targetUid,
        fullName: data.fullName,
        adminPin: data.adminPin,
    });
    const callerSnap = await (0, accessPinSecretsShared_1.getDb)()
        .collection(DISPATCHER_ROLES_COLLECTION)
        .doc(callerUid)
        .get();
    const callerData = callerSnap.data();
    const actorFullName = typeof callerData?.fullName === "string"
        ? callerData.fullName
        : undefined;
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "admin_bootstrap",
        targetType: "dispatcher",
        targetId: result.uid,
        actorUid: callerUid,
        actorFullName,
    });
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "admin_created",
        targetType: "dispatcher",
        targetId: result.uid,
        actorUid: callerUid,
        actorFullName,
    });
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "admin_pin_set",
        targetType: "dispatcher",
        targetId: result.uid,
        actorUid: callerUid,
        actorFullName,
    });
    return result;
});
//# sourceMappingURL=bootstrapFirstAdmin.js.map