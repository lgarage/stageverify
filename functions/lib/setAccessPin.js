"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAccessPin = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const managementPinRegistry_1 = require("./managementPinRegistry");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const pinMatching_1 = require("./pinMatching");
const pinHashing_1 = require("./pinHashing");
const MAX_SET_ATTEMPTS_PER_WINDOW = 8;
const SET_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_SET_ATTEMPT_INTERVAL_MS = 750;
async function checkSetRateLimit(attemptKey) {
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SET_ATTEMPTS_COLLECTION)
        .doc(attemptKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await (0, accessPinSecretsShared_1.getDb)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {});
        const windowStart = data.windowStartedAt
            ? Date.parse(data.windowStartedAt)
            : now;
        const inWindow = now - windowStart < SET_ATTEMPT_WINDOW_MS;
        const count = inWindow ? (data.count ?? 0) : 0;
        if (inWindow && count >= MAX_SET_ATTEMPTS_PER_WINDOW) {
            throw new https_1.HttpsError("resource-exhausted", "Too many PIN set attempts. Try again later.");
        }
        const lastAttempt = data.lastAttemptAt
            ? Date.parse(data.lastAttemptAt)
            : 0;
        if (lastAttempt && now - lastAttempt < MIN_SET_ATTEMPT_INTERVAL_MS) {
            throw new https_1.HttpsError("resource-exhausted", "Please wait a moment before trying again.");
        }
        tx.set(ref, {
            count: inWindow ? count + 1 : 1,
            windowStartedAt: inWindow
                ? (data.windowStartedAt ?? nowIso)
                : nowIso,
            lastAttemptAt: nowIso,
        }, { merge: true });
    });
}
function managementEntityPatch(now) {
    return {
        pinHash: firestore_1.FieldValue.delete(),
        pinConfigured: true,
        updatedAt: now,
    };
}
function technicianVendorEntityPatch(now) {
    return {
        pinConfigured: true,
        pinCode: firestore_1.FieldValue.delete(),
        pinHash: firestore_1.FieldValue.delete(),
        updatedAt: now,
    };
}
/** Dispatcher sets access PIN — hash + encrypt in CF-only secrets doc. */
exports.setAccessPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    const pin = (0, pinMatching_1.asFourDigitPin)(data.pin);
    const sessionToken = typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";
    if (!targetType || !targetId || !pin) {
        throw new https_1.HttpsError("invalid-argument", "Invalid PIN access target.");
    }
    const attemptKey = `set:${targetType}:${uid}`;
    await checkSetRateLimit(attemptKey);
    const hasExisting = await (0, accessPinTargetHelpers_1.targetHasExistingAccessPin)(targetType, targetId);
    let validatedSessionId = null;
    let validatedSessionRaw = null;
    if (hasExisting) {
        if (!sessionToken) {
            throw new https_1.HttpsError("permission-denied", "Admin access session required to change an existing PIN.");
        }
        const sessionCheck = await (0, adminAccessSession_1.validateAdminAccessSession)({
            sessionToken,
            managerUid: uid,
            targetType,
            targetId,
        });
        if (!sessionCheck.ok) {
            throw new https_1.HttpsError("permission-denied", "Admin access session invalid or expired.");
        }
        const parsedSession = (0, adminAccessSession_1.parseAdminAccessSessionToken)(sessionToken);
        if (!parsedSession) {
            throw new https_1.HttpsError("permission-denied", "Admin access session invalid or expired.");
        }
        validatedSessionId = parsedSession.sessionId;
        validatedSessionRaw = parsedSession.raw;
    }
    // Initial assign: ignore optional sessionToken — do not validate or consume.
    const db = (0, accessPinSecretsShared_1.getDb)();
    const entityRef = (0, accessPinTargetHelpers_1.entityRefForTarget)(targetType, targetId);
    const secretRef = db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, targetId));
    const pinLookupKey = (0, accessPinCrypto_1.pinLookupKeyForPin)(pin);
    const uniquenessRef = db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_UNIQUENESS_COLLECTION)
        .doc((0, accessPinSecretsShared_1.accessPinUniquenessDocId)(targetType, pinLookupKey));
    const auditRef = db.collection(accessPinSecretsShared_1.PIN_ACCESS_AUDIT_COLLECTION).doc();
    const now = new Date().toISOString();
    const pinHash = (0, pinHashing_1.hashPinForStorage)(pin);
    const pinEncrypted = (0, accessPinCrypto_1.encryptPinForStorage)(pin);
    await db.runTransaction(async (tx) => {
        const entitySnap = await tx.get(entityRef);
        if (!entitySnap.exists && targetType !== "management") {
            throw new https_1.HttpsError("not-found", "Target not found.");
        }
        const existingSecretSnap = await tx.get(secretRef);
        const uniquenessSnap = await tx.get(uniquenessRef);
        if (uniquenessSnap.exists) {
            const existing = uniquenessSnap.data();
            if (existing.targetId && existing.targetId !== targetId) {
                throw new https_1.HttpsError("already-exists", "Could not set PIN.");
            }
        }
        if (existingSecretSnap.exists) {
            const oldSecret = existingSecretSnap.data();
            if (oldSecret.revealable &&
                oldSecret.pinEncrypted?.ciphertext &&
                oldSecret.pinEncrypted.ciphertext.length > 0) {
                try {
                    const oldPin = (0, accessPinCrypto_1.decryptPinFromStorage)(oldSecret.pinEncrypted);
                    if (oldPin !== pin) {
                        const oldUniquenessRef = db
                            .collection(accessPinSecretsShared_1.ACCESS_PIN_UNIQUENESS_COLLECTION)
                            .doc((0, accessPinSecretsShared_1.accessPinUniquenessDocId)(targetType, (0, accessPinCrypto_1.pinLookupKeyForPin)(oldPin)));
                        tx.delete(oldUniquenessRef);
                    }
                }
                catch {
                    // Hash-only or corrupt prior secret — skip old uniqueness cleanup.
                }
            }
        }
        tx.set(secretRef, {
            targetType,
            targetId,
            pinHash,
            pinEncrypted,
            pinLookupKey,
            revealable: true,
            updatedAt: now,
        });
        tx.set(uniquenessRef, {
            targetType,
            targetId,
            updatedAt: now,
        });
        if (targetType === "management") {
            const mgmtBase = entitySnap.exists
                ? entitySnap.data()
                : {};
            tx.set(entityRef, {
                id: targetId,
                label: mgmtBase.label ?? "Management PIN",
                active: mgmtBase.active ?? true,
                permissions: entitySnap.exists
                    ? (0, managementPinRegistry_1.normalizeManagementPinPermissions)(mgmtBase.permissions)
                    : (0, managementPinRegistry_1.normalizeManagementPinPermissions)(null),
                createdAt: entitySnap.exists ? undefined : now,
                ...managementEntityPatch(now),
            }, { merge: true });
        }
        else {
            tx.set(entityRef, technicianVendorEntityPatch(now), { merge: true });
        }
        if (targetType === "management") {
            tx.set(db.collection("appSettings").doc("config"), {
                managementPinConfigured: true,
                updatedAt: now,
            }, { merge: true });
        }
        tx.set(auditRef, {
            action: "pin_changed",
            targetType,
            targetId,
            actorUid: uid,
            createdAt: now,
        });
        if (validatedSessionId && validatedSessionRaw) {
            const sessionRef = db
                .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
                .doc(validatedSessionId);
            const sessionSnap = await tx.get(sessionRef);
            if (!sessionSnap.exists) {
                throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
            }
            const session = sessionSnap.data();
            if (session.secretHash !== (0, adminAccessSession_1.hashAdminAccessSessionRaw)(validatedSessionRaw)) {
                throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
            }
            if (session.revoked || session.consumedAt) {
                throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
            }
            if (Date.parse(session.expiresAt) <= Date.now()) {
                throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
            }
            if (session.managerUid !== uid) {
                throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
            }
            if (session.targetType !== targetType ||
                session.targetId !== targetId) {
                throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
            }
            tx.set(sessionRef, { consumedAt: now }, { merge: true });
        }
    });
    return { success: true, targetType, targetId, pinConfigured: true };
});
//# sourceMappingURL=setAccessPin.js.map