"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeManagementPinWrite = authorizeManagementPinWrite;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function asPinIdForAuth(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed))
        return null;
    return trimmed;
}
/** Callable auth for management PIN writes — mirrors setAccessPin pin-path rules. */
async function authorizeManagementPinWrite(request, input) {
    const pinProvided = input.pin !== undefined;
    const sessionToken = typeof input.sessionToken === "string" ? input.sessionToken.trim() : "";
    if (!pinProvided) {
        const actorUid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
        return { actorUid, sessionConsumption: null };
    }
    const actorUid = await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const targetId = input.fixedTargetId ??
        asPinIdForAuth(input.id) ??
        null;
    const hasExisting = targetId
        ? await (0, accessPinTargetHelpers_1.targetHasExistingAccessPin)("management", targetId)
        : false;
    if (!hasExisting) {
        return { actorUid, sessionConsumption: null };
    }
    if (!targetId) {
        throw new https_1.HttpsError("internal", "Invalid management PIN target.");
    }
    if (!sessionToken) {
        throw new https_1.HttpsError("permission-denied", "Admin access session required to change an existing PIN.");
    }
    const sessionCheck = await (0, adminAccessSession_1.validateAdminAccessSession)({
        sessionToken,
        managerUid: actorUid,
        targetType: "management",
        targetId,
    });
    if (!sessionCheck.ok) {
        throw new https_1.HttpsError("permission-denied", "Admin access session invalid or expired.");
    }
    const parsedSession = (0, adminAccessSession_1.parseAdminAccessSessionToken)(sessionToken);
    if (!parsedSession) {
        throw new https_1.HttpsError("permission-denied", "Admin access session invalid or expired.");
    }
    return {
        actorUid,
        sessionConsumption: {
            sessionId: parsedSession.sessionId,
            raw: parsedSession.raw,
        },
    };
}
//# sourceMappingURL=managementPinWriteAuth.js.map