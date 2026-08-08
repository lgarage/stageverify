"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revealAccessPin = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const REVEALED_FOR_MS = 25_000;
const MAX_ATTEMPTS_PER_WINDOW = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ATTEMPT_INTERVAL_MS = 750;
async function checkRevealRateLimit(attemptKey) {
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
        .doc(attemptKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await (0, accessPinSecretsShared_1.getDb)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {});
        const windowStart = data.windowStartedAt
            ? Date.parse(data.windowStartedAt)
            : now;
        const inWindow = now - windowStart < ATTEMPT_WINDOW_MS;
        const count = inWindow ? (data.count ?? 0) : 0;
        if (inWindow && count >= MAX_ATTEMPTS_PER_WINDOW) {
            throw new https_1.HttpsError("resource-exhausted", "Too many reveal attempts. Try again later.");
        }
        const lastAttempt = data.lastAttemptAt
            ? Date.parse(data.lastAttemptAt)
            : 0;
        if (lastAttempt && now - lastAttempt < MIN_ATTEMPT_INTERVAL_MS) {
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
/** Manager reveals a configured PIN (25s client auto-hide). Requires live admin session. */
exports.revealAccessPin = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    const sessionToken = typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";
    if (!targetType || !targetId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid PIN access target.");
    }
    let uid;
    try {
        uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError &&
            err.code === "permission-denied" &&
            request.auth?.uid) {
            await (0, accessPinSecretsShared_1.writePinAccessAuditBestEffort)({
                action: "pin_reveal_denied",
                targetType,
                targetId,
                actorUid: request.auth.uid,
            });
        }
        throw err;
    }
    const sessionCheck = await (0, adminAccessSession_1.validateAdminAccessSession)({
        sessionToken,
        managerUid: uid,
        targetType,
        targetId,
    });
    if (!sessionCheck.ok) {
        await (0, accessPinSecretsShared_1.writePinAccessAuditBestEffort)({
            action: "pin_reveal_denied",
            targetType,
            targetId,
            actorUid: uid,
        });
        throw new https_1.HttpsError("permission-denied", "Admin access session invalid or expired.");
    }
    const attemptKey = `reveal:${targetType}:${targetId}:${uid}`;
    await checkRevealRateLimit(attemptKey);
    await (0, accessPinTargetHelpers_1.assertAccessPinTargetExists)(targetType, targetId);
    const db = (0, accessPinSecretsShared_1.getDb)();
    const secretRef = db
        .collection("accessPinSecrets")
        .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, targetId));
    const secretSnap = await secretRef.get();
    if (!secretSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "PIN is not configured.");
    }
    const secret = secretSnap.data();
    if (secret.revealable !== true) {
        throw new https_1.HttpsError("failed-precondition", "This PIN was migrated from a hash-only record and cannot be revealed.");
    }
    if (!secret.pinEncrypted) {
        throw new https_1.HttpsError("failed-precondition", "PIN is not revealable.");
    }
    let pin;
    try {
        pin = (0, accessPinCrypto_1.decryptPinFromStorage)(secret.pinEncrypted);
    }
    catch (err) {
        console.error("revealAccessPin decrypt failed:", err);
        throw new https_1.HttpsError("internal", "Could not reveal PIN.");
    }
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "pin_revealed",
        targetType,
        targetId,
        actorUid: uid,
    });
    return { pin, revealedForMs: REVEALED_FOR_MS };
});
//# sourceMappingURL=revealAccessPin.js.map