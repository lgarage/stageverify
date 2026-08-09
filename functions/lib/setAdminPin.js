"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAdminPin = void 0;
/**
 * Self-targeted Admin PIN set/reset (hash-only).
 * Caller must already be an active Admin (bootstrap promotion is a separate callable).
 */
const https_1 = require("firebase-functions/v2/https");
const adminPinSecret_1 = require("./adminPinSecret");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
exports.setAdminPin = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    let uid;
    try {
        uid = await (0, dispatcherAuth_1.requireAdminAuth)(request);
    }
    catch (err) {
        if (err instanceof https_1.HttpsError && request.auth?.uid) {
            await (0, accessPinSecretsShared_1.writePinAccessAuditBestEffort)({
                action: "admin_pin_set_denied",
                targetType: "dispatcher",
                targetId: request.auth.uid,
                actorUid: request.auth.uid,
            });
        }
        throw err;
    }
    const data = (request.data ?? {});
    const pin = (0, adminPinSecret_1.asAdminPin)(data.adminPin);
    if (!pin) {
        await (0, accessPinSecretsShared_1.writePinAccessAuditBestEffort)({
            action: "admin_pin_set_denied",
            targetType: "dispatcher",
            targetId: uid,
            actorUid: uid,
        });
        throw new https_1.HttpsError("invalid-argument", "Admin PIN must be exactly 6 digits.");
    }
    const roleDoc = await (0, dispatcherAuth_1.readDispatcherRoleDoc)(uid);
    const fullName = typeof roleDoc?.fullName === "string" ? roleDoc.fullName : undefined;
    await (0, adminPinSecret_1.setOwnAdminPin)(uid, pin);
    await (0, accessPinSecretsShared_1.writePinAccessAudit)({
        action: "admin_pin_set",
        targetType: "dispatcher",
        targetId: uid,
        actorUid: uid,
        actorFullName: fullName,
    });
    return { success: true };
});
//# sourceMappingURL=setAdminPin.js.map