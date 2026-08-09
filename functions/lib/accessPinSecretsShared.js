"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_PIN_UNIQUENESS_TARGET_TYPES = exports.FIRST_ADMIN_BOOTSTRAP_LOCK_ID = exports.ACCESS_CONTROL_LOCKS_COLLECTION = exports.ADMIN_ACCESS_SESSIONS_COLLECTION = exports.ACCESS_PIN_SET_ATTEMPTS_COLLECTION = exports.ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = exports.PIN_ACCESS_AUDIT_COLLECTION = exports.ACCESS_PIN_UNIQUENESS_COLLECTION = exports.ACCESS_PIN_SECRETS_COLLECTION = void 0;
exports.getDb = getDb;
exports.accessPinSecretDocId = accessPinSecretDocId;
exports.accessPinUniquenessDocId = accessPinUniquenessDocId;
exports.legacyAccessPinUniquenessDocId = legacyAccessPinUniquenessDocId;
exports.uniquenessBelongsToOtherTarget = uniquenessBelongsToOtherTarget;
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
exports.ACCESS_CONTROL_LOCKS_COLLECTION = "accessControlLocks";
exports.FIRST_ADMIN_BOOTSTRAP_LOCK_ID = "firstAdmin";
function getDb() {
    return admin.firestore();
}
function accessPinSecretDocId(targetType, targetId) {
    return `${targetType}_${targetId}`;
}
/** Global uniqueness index doc id — arg is HMAC lookup key from pinLookupKeyForPin, not plaintext PIN. */
function accessPinUniquenessDocId(pinLookupKey) {
    return `global_${pinLookupKey}`;
}
/**
 * Pre–D-74 per-type uniqueness doc id (`technician_|vendor_|management_` + lookup key).
 * Retained for dual-check on write so legacy index rows still block cross-target reuse.
 */
function legacyAccessPinUniquenessDocId(targetType, pinLookupKey) {
    return `${targetType}_${pinLookupKey}`;
}
exports.ACCESS_PIN_UNIQUENESS_TARGET_TYPES = [
    "technician",
    "vendor",
    "management",
];
/** True when an uniqueness index row belongs to a different target. */
function uniquenessBelongsToOtherTarget(existing, targetType, targetId) {
    if (!existing)
        return false;
    if (existing.targetId && existing.targetId !== targetId)
        return true;
    if (existing.targetType && existing.targetType !== targetType)
        return true;
    return false;
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