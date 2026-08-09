"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_ACCESS_SESSIONS_COLLECTION = exports.ACCESS_PIN_SET_ATTEMPTS_COLLECTION = exports.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = exports.PIN_ACCESS_AUDIT_COLLECTION = exports.ACCESS_PIN_UNIQUENESS_COLLECTION = exports.ACCESS_PIN_SECRETS_COLLECTION = void 0;
exports.getDb = getDb;
exports.accessPinSecretDocId = accessPinSecretDocId;
exports.accessPinUniquenessDocId = accessPinUniquenessDocId;
exports.parseAccessPinTargetType = parseAccessPinTargetType;
exports.writePinAccessAudit = writePinAccessAudit;
exports.writePinAccessAuditBestEffort = writePinAccessAuditBestEffort;
const admin = require("firebase-admin");
exports.ACCESS_PIN_SECRETS_COLLECTION = "accessPinSecrets";
exports.ACCESS_PIN_UNIQUENESS_COLLECTION = "accessPinUniqueness";
exports.PIN_ACCESS_AUDIT_COLLECTION = "pinAccessAudit";
exports.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = "accessPinRevealAttempts";
exports.ACCESS_PIN_SET_ATTEMPTS_COLLECTION = "accessPinSetAttempts";
exports.ADMIN_ACCESS_SESSIONS_COLLECTION = "adminAccessSessions";
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
    if (value === "technician" ||
        value === "vendor" ||
        value === "management") {
        return value;
    }
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
    if (typeof input.actorFullName === "string" && input.actorFullName.trim()) {
        doc.actorFullName = input.actorFullName.trim();
    }
    await ref.set(doc);
    return ref.id;
}
/** Best-effort audit when manager check fails — never throws. */
async function writePinAccessAuditBestEffort(input) {
    try {
        await writePinAccessAudit({
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            actorUid: input.actorUid ?? "unknown",
        });
    }
    catch (err) {
        console.error(`pinAccessAudit ${input.action} write failed:`, err);
    }
}
//# sourceMappingURL=accessPinSecretsShared.js.map