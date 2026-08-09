"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAdminAccessSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const adminPinSecret_1 = require("./adminPinSecret");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const MAX_ADMIN_PIN_ATTEMPTS_PER_WINDOW = 8;
const ADMIN_PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ADMIN_PIN_ATTEMPT_INTERVAL_MS = 750;
async function checkAdminPinRateLimit(uid) {
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
        .doc(`adminPinAuth:${uid}`);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await (0, accessPinSecretsShared_1.getDb)().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : {});
        const windowStart = data.windowStartedAt
            ? Date.parse(data.windowStartedAt)
            : now;
        const inWindow = now - windowStart < ADMIN_PIN_ATTEMPT_WINDOW_MS;
        const count = inWindow ? (data.count ?? 0) : 0;
        if (inWindow && count >= MAX_ADMIN_PIN_ATTEMPTS_PER_WINDOW) {
            throw new https_1.HttpsError("resource-exhausted", "Too many Admin PIN attempts. Try again later.");
        }
        const lastAttempt = data.lastAttemptAt
            ? Date.parse(data.lastAttemptAt)
            : 0;
        if (lastAttempt && now - lastAttempt < MIN_ADMIN_PIN_ATTEMPT_INTERVAL_MS) {
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
async function clearAdminPinRateLimit(uid) {
    await (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
        .doc(`adminPinAuth:${uid}`)
        .delete()
        .catch(() => undefined);
}
/** Active Admin + own Admin PIN mints a row-scoped admin access session (5 min TTL). */
exports.startAdminAccessSession = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    if (!targetType || !targetId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid PIN access target.");
    }
    let uid;
    try {
        uid = await (0, dispatcherAuth_1.requireAdminAuth)(request);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError &&
            err.code === "permission-denied" &&
            request.auth?.uid) {
            await (0, accessPinSecretsShared_1.writePinAccessAuditBestEffort)({
                action: "admin_access_denied",
                targetType,
                targetId,
                actorUid: request.auth.uid,
            });
        }
        throw err;
    }
    const roleDoc = await (0, dispatcherAuth_1.readDispatcherRoleDoc)(uid);
    const actorFullName = typeof roleDoc?.fullName === "string" ? roleDoc.fullName : undefined;
    await checkAdminPinRateLimit(uid);
    const pinOk = await (0, adminPinSecret_1.verifyOwnAdminPinForSession)(uid, data.adminPin);
    if (!pinOk) {
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_access_denied",
            targetType,
            targetId,
            actorUid: uid,
            actorFullName,
        });
        throw new https_1.HttpsError("permission-denied", "Invalid Admin PIN.");
    }
    await clearAdminPinRateLimit(uid);
    await (0, accessPinTargetHelpers_1.assertAccessPinTargetExists)(targetType, targetId);
    const session = await (0, adminAccessSession_1.createAdminAccessSession)({
        managerUid: uid,
        targetType,
        targetId,
    });
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "admin_access_granted",
        targetType,
        targetId,
        actorUid: uid,
        actorFullName,
    });
    return {
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
    };
});
//# sourceMappingURL=startAdminAccessSession.js.map