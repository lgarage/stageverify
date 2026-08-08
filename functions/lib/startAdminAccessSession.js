"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAdminAccessSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
/** Manager mints a row-scoped admin access session (5 min TTL). */
exports.startAdminAccessSession = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const data = (request.data ?? {});
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    if (!targetType || !targetId) {
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
                action: "admin_access_denied",
                targetType,
                targetId,
                actorUid: request.auth.uid,
            });
        }
        throw err;
    }
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
    });
    return {
        sessionToken: session.sessionToken,
        expiresAt: session.expiresAt,
    };
});
//# sourceMappingURL=startAdminAccessSession.js.map