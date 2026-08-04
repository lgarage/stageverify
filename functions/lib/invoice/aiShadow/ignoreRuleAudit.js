"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IGNORE_RULE_AUDIT_COLLECTION = void 0;
exports.writeIgnoreRuleAuditEvent = writeIgnoreRuleAuditEvent;
exports.listIgnoreRuleAuditEvents = listIgnoreRuleAuditEvents;
exports.IGNORE_RULE_AUDIT_COLLECTION = "ignoreRuleAuditEvents";
async function writeIgnoreRuleAuditEvent(db, input) {
    const atIso = new Date().toISOString();
    const ref = db.collection(exports.IGNORE_RULE_AUDIT_COLLECTION).doc();
    const doc = {
        ruleId: input.ruleId.trim(),
        eventType: input.eventType,
        actorUid: input.actorUid,
        atIso,
        ...(input.importId?.trim() ? { importId: input.importId.trim() } : {}),
        ...(input.detail?.trim()
            ? { detail: input.detail.trim().slice(0, 500) }
            : {}),
    };
    await ref.set(doc);
    return ref.id;
}
async function listIgnoreRuleAuditEvents(db, input) {
    const ruleId = input.ruleId.trim();
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const snap = await db
        .collection(exports.IGNORE_RULE_AUDIT_COLLECTION)
        .where("ruleId", "==", ruleId)
        .orderBy("atIso", "desc")
        .limit(limit)
        .get();
    return snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
    }));
}
//# sourceMappingURL=ignoreRuleAudit.js.map