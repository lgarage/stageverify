"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAccessPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretWrite_1 = require("./accessPinSecretWrite");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const pinMatching_1 = require("./pinMatching");
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
/** Dispatcher sets access PIN — hash + encrypt in CF-only secrets doc. */
exports.setAccessPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    const pin = (0, pinMatching_1.asAccessPin)(data.pin);
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
    const refs = (0, accessPinSecretWrite_1.prepareAccessPinSecretWrite)(targetType, targetId, pin);
    const auditRef = db.collection(accessPinSecretsShared_1.PIN_ACCESS_AUDIT_COLLECTION).doc();
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
        // ALL reads before ANY writes (incl. session consume for existing-PIN rotate).
        const entitySnap = await tx.get(refs.entityRef);
        if (!entitySnap.exists && targetType !== "management") {
            throw new https_1.HttpsError("not-found", "Target not found.");
        }
        const existingSecretSnap = await tx.get(refs.secretRef);
        const uniquenessSnap = await tx.get(refs.uniquenessRef);
        const legacyUniquenessSnaps = await Promise.all(refs.legacyUniquenessRefs.map((ref) => tx.get(ref)));
        let sessionRef = null;
        let sessionSnap = null;
        if (validatedSessionId && validatedSessionRaw) {
            sessionRef = db
                .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
                .doc(validatedSessionId);
            sessionSnap = await tx.get(sessionRef);
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
        }
        await (0, accessPinSecretWrite_1.applyAccessPinSecretWriteInTransaction)(tx, db, {
            targetType,
            targetId,
            pin,
            now,
            refs,
            existingSecretSnap,
            uniquenessSnap,
            legacyUniquenessSnaps,
            entitySnap,
        });
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
        if (sessionRef) {
            tx.set(sessionRef, { consumedAt: now }, { merge: true });
        }
    });
    return { success: true, targetType, targetId, pinConfigured: true };
});
//# sourceMappingURL=setAccessPin.js.map