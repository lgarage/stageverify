"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_LESSON_AUDIT_COLLECTION = void 0;
exports.buildFieldLessonAuditEventDoc = buildFieldLessonAuditEventDoc;
exports.writeFieldLessonAuditEventInTransaction = writeFieldLessonAuditEventInTransaction;
exports.writeFieldLessonAuditEvent = writeFieldLessonAuditEvent;
exports.FIELD_LESSON_AUDIT_COLLECTION = "vendorInvoiceFieldLessonAuditEvents";
function buildFieldLessonAuditEventDoc(input, atIso) {
    return {
        lessonId: input.lessonId.trim(),
        eventType: input.eventType,
        actorUid: input.actorUid,
        atIso,
        ...(input.priorStatus !== undefined
            ? { priorStatus: input.priorStatus }
            : {}),
        ...(input.newStatus !== undefined ? { newStatus: input.newStatus } : {}),
        ...(input.detail?.trim()
            ? { detail: input.detail.trim().slice(0, 500) }
            : {}),
        ...(input.scopeKey?.trim() ? { scopeKey: input.scopeKey.trim() } : {}),
        ...(input.patternFingerprint?.trim()
            ? { patternFingerprint: input.patternFingerprint.trim() }
            : {}),
        ...(typeof input.distinctDocumentCount === "number"
            ? { distinctDocumentCount: input.distinctDocumentCount }
            : {}),
    };
}
function writeFieldLessonAuditEventInTransaction(tx, auditRef, input, atIso) {
    tx.set(auditRef, buildFieldLessonAuditEventDoc(input, atIso));
}
async function writeFieldLessonAuditEvent(db, input) {
    const atIso = new Date().toISOString();
    const ref = db.collection(exports.FIELD_LESSON_AUDIT_COLLECTION).doc();
    await ref.set(buildFieldLessonAuditEventDoc(input, atIso));
    return ref.id;
}
//# sourceMappingURL=fieldLessonAudit.js.map