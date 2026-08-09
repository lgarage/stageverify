"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverFieldCorrectionLogFromAudit = recoverFieldCorrectionLogFromAudit;
const correctionAllowlist_1 = require("./correctionAllowlist");
const AUDIT_COLLECTION = "vendorInvoiceFieldCorrections";
function asLogEntry(raw) {
    if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(raw.field))
        return null;
    const newValue = typeof raw.newValue === "string" ? raw.newValue.trim() : "";
    if (!newValue)
        return null;
    const previousValue = typeof raw.previousValue === "string" ? raw.previousValue : "";
    return {
        field: raw.field,
        previousValue,
        newValue,
        ...(typeof raw.appliedAt === "string" ? { at: raw.appliedAt } : {}),
        ...(typeof raw.appliedByUid === "string" ? { by: raw.appliedByUid } : {}),
        ...(typeof raw.id === "string"
            ? { correctionId: raw.id }
            : typeof raw.correctionId === "string"
                ? { correctionId: raw.correctionId }
                : {}),
    };
}
/**
 * Load audit corrections for one import and collapse to latest-per-field log.
 * Returns [] when none exist (caller keeps empty log).
 */
async function recoverFieldCorrectionLogFromAudit(db, vendorInvoiceImportId) {
    const importId = vendorInvoiceImportId.trim();
    if (!importId)
        return [];
    const snap = await db
        .collection(AUDIT_COLLECTION)
        .where("vendorInvoiceImportId", "==", importId)
        .get();
    if (snap.empty)
        return [];
    const byField = new Map();
    const ranked = [];
    for (const doc of snap.docs) {
        const data = doc.data();
        const entry = asLogEntry({ ...data, id: data.id ?? doc.id });
        if (!entry)
            continue;
        const at = typeof data.appliedAt === "string"
            ? data.appliedAt
            : typeof entry.at === "string"
                ? entry.at
                : "";
        ranked.push({ at, entry });
    }
    ranked.sort((a, b) => a.at.localeCompare(b.at));
    for (const row of ranked) {
        byField.set(row.entry.field, row.entry);
    }
    return [...byField.values()].slice(-20);
}
//# sourceMappingURL=correctionAuditRecovery.js.map