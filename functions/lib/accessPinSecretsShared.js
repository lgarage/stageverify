"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = exports.PIN_ACCESS_AUDIT_COLLECTION = exports.ACCESS_PIN_UNIQUENESS_COLLECTION = exports.ACCESS_PIN_SECRETS_COLLECTION = void 0;
exports.getDb = getDb;
exports.accessPinSecretDocId = accessPinSecretDocId;
exports.accessPinUniquenessDocId = accessPinUniquenessDocId;
exports.parseAccessPinTargetType = parseAccessPinTargetType;
exports.writePinAccessAudit = writePinAccessAudit;
exports.writePinRevealDeniedAuditBestEffort = writePinRevealDeniedAuditBestEffort;
const admin = require("firebase-admin");
exports.ACCESS_PIN_SECRETS_COLLECTION = "accessPinSecrets";
exports.ACCESS_PIN_UNIQUENESS_COLLECTION = "accessPinUniqueness";
exports.PIN_ACCESS_AUDIT_COLLECTION = "pinAccessAudit";
exports.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = "accessPinRevealAttempts";
function getDb() {
    return admin.firestore();
}
function accessPinSecretDocId(targetType, targetId) {
    return `${targetType}_${targetId}`;
}
/** Uniqueness index doc id — second arg is HMAC lookup key from pinLookupKeyForPin, not plaintext PIN. */
function accessPinUniquenessDocId(targetType, pinLookupKey) {
    return `${targetType}_${pinLookupKey}`;
}
function parseAccessPinTargetType(value) {
    if (value === "technician" || value === "vendor")
        return value;
    return null;
}
/** Write audit entry — throws on failure (fail-closed for reveal path). */
async function writePinAccessAudit(input) {
    const ref = getDb().collection(exports.PIN_ACCESS_AUDIT_COLLECTION).doc();
    const createdAt = new Date().toISOString();
    const doc = {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        actorUid: input.actorUid,
        createdAt,
    };
    await ref.set(doc);
    return ref.id;
}
/** Best-effort audit when manager check fails — never throws. */
async function writePinRevealDeniedAuditBestEffort(input) {
    try {
        await writePinAccessAudit({
            action: "PIN_REVEAL_DENIED",
            targetType: input.targetType,
            targetId: input.targetId,
            actorUid: input.actorUid ?? "unknown",
        });
    }
    catch (err) {
        console.error("pinAccessAudit PIN_REVEAL_DENIED write failed:", err);
    }
}
//# sourceMappingURL=accessPinSecretsShared.js.map