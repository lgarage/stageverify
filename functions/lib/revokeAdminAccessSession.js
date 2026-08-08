"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokeAdminAccessSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
/** Idempotent revoke — audit only when session actually revoked. */
exports.revokeAdminAccessSession = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const sessionToken = typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";
    const targetType = (0, accessPinSecretsShared_1.parseAccessPinTargetType)(data.targetType);
    const targetId = typeof data.targetId === "string" ? data.targetId.trim() : "";
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "sessionToken is required.");
    }
    const didRevoke = await (0, adminAccessSession_1.revokeAdminAccessSessionByToken)(sessionToken);
    if (didRevoke && targetType && targetId) {
        await (0, accessPinSecretsShared_1.writePinAccessAudit)({
            action: "admin_access_revoked",
            targetType,
            targetId,
            actorUid: uid,
        });
    }
    return { success: true, revoked: didRevoke };
});
//# sourceMappingURL=revokeAdminAccessSession.js.map