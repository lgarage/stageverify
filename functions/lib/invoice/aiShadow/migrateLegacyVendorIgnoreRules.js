"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateLegacyVendorIgnoreRulesCore = migrateLegacyVendorIgnoreRulesCore;
const adminConfig_1 = require("./adminConfig");
const ignoreRuleAudit_1 = require("./ignoreRuleAudit");
const notifyTrainingLessonPending_1 = require("./notifyTrainingLessonPending");
const vendorIgnoreRules_1 = require("./vendorIgnoreRules");
const vendorIgnoreEcho_1 = require("../vendorIgnoreEcho");
function isLegacyVendorOnlyDoc(docId, data) {
    if (docId.includes("__"))
        return false;
    if (data.ignoreCreditReturns !== true)
        return false;
    if (typeof data.documentType === "string" && data.documentType !== "") {
        return false;
    }
    return true;
}
async function senderDomainsFromSourceImport(db, sourceImportId) {
    if (!sourceImportId?.trim())
        return [];
    const importSnap = await db
        .collection("vendorInvoiceImports")
        .doc(sourceImportId.trim())
        .get();
    if (!importSnap.exists)
        return [];
    const importDoc = importSnap.data();
    const inboundId = importDoc.inboundEmailProcessingId?.trim();
    if (!inboundId)
        return [];
    const inboundSnap = await db
        .collection("inboundEmailProcessing")
        .doc(inboundId)
        .get();
    if (!inboundSnap.exists)
        return [];
    const senderEmail = typeof inboundSnap.data()?.senderEmail === "string"
        ? inboundSnap.data().senderEmail
        : "";
    return (0, vendorIgnoreEcho_1.normalizeSenderDomains)([senderEmail]);
}
async function archiveLegacyDocById(db, legacyDocId, uid, reason, detail) {
    const legacyRef = db.collection(vendorIgnoreRules_1.VENDOR_IGNORE_RULES_COLLECTION).doc(legacyDocId);
    const legacySnap = await legacyRef.get();
    if (!legacySnap.exists)
        return;
    const legacyData = legacySnap.data();
    if (legacyData.status === "archived")
        return;
    const now = new Date().toISOString();
    await legacyRef.set({
        status: "archived",
        enabled: false,
        archivedBy: uid,
        archivedAt: now,
        archivedReason: reason,
        updatedAt: now,
        updatedBy: uid,
    }, { merge: true });
    await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
        ruleId: legacyDocId,
        eventType: "archived",
        actorUid: uid,
        detail: detail ?? reason,
    });
}
async function migrateLegacyVendorIgnoreRulesCore(db, uid) {
    const result = {
        scanned: 0,
        migrated: 0,
        skipped: 0,
        proposedCount: 0,
        activeCount: 0,
        errors: [],
    };
    const snap = await db.collection(vendorIgnoreRules_1.VENDOR_IGNORE_RULES_COLLECTION).get();
    const proposedRuleIds = [];
    for (const docSnap of snap.docs) {
        const data = (docSnap.data() ?? {});
        if (!isLegacyVendorOnlyDoc(docSnap.id, data))
            continue;
        result.scanned++;
        const vendorKey = typeof data.vendorKey === "string" && data.vendorKey.trim()
            ? data.vendorKey.trim()
            : docSnap.id;
        const parserFormatId = vendorKey.includes("first") || vendorKey.includes("1supply")
            ? "first_supply"
            : "johnstone";
        const fingerprint = {
            vendorKey,
            parserFormatId,
            documentType: "credit_memo",
        };
        const newId = (0, vendorIgnoreRules_1.ignoreRuleDocId)(fingerprint);
        const existingNew = await (0, vendorIgnoreRules_1.getVendorIgnoreRuleById)(db, newId);
        if (existingNew && existingNew.status !== "archived") {
            result.skipped++;
            try {
                await archiveLegacyDocById(db, docSnap.id, uid, "legacy_migration_superseded", `superseded by existing ${newId}`);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                result.errors.push(`${docSnap.id}: ${message}`);
            }
            continue;
        }
        const sourceImportId = typeof data.sourceImportId === "string" ? data.sourceImportId : undefined;
        const senderDomains = await senderDomainsFromSourceImport(db, sourceImportId);
        const status = senderDomains.length > 0 ? "active" : "proposed";
        try {
            const now = new Date().toISOString();
            await (0, vendorIgnoreRules_1.upsertVendorIgnoreRule)(db, {
                fingerprint,
                status,
                uid,
                sourceImportId,
                taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : now,
                proposedBy: status === "proposed" ? uid : undefined,
                proposedAt: status === "proposed" ? now : undefined,
                activatedBy: status === "active" ? uid : undefined,
                activatedAt: status === "active" ? now : undefined,
                senderDomains: senderDomains.length > 0 ? senderDomains : undefined,
                clearDomainGrace: senderDomains.length > 0,
            });
            await (0, ignoreRuleAudit_1.writeIgnoreRuleAuditEvent)(db, {
                ruleId: newId,
                eventType: status === "active" ? "activated" : "proposed",
                actorUid: uid,
                importId: sourceImportId,
                detail: `legacy_migration from ${docSnap.id}`,
            });
            await archiveLegacyDocById(db, docSnap.id, uid, "legacy_migration_replaced", `replaced by ${newId}`);
            result.migrated++;
            if (status === "proposed") {
                result.proposedCount++;
                proposedRuleIds.push(newId);
            }
            else {
                result.activeCount++;
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push(`${docSnap.id}: ${message}`);
        }
    }
    if (proposedRuleIds.length > 0) {
        const alertEmail = await (0, adminConfig_1.readAlertEmailFromSecrets)();
        if (alertEmail) {
            await (0, notifyTrainingLessonPending_1.notifyTrainingLessonPendingAdmin)({
                alertEmail,
                vendorKey: "legacy-migration",
                reason: `Legacy ignore-rule migration created ${proposedRuleIds.length} proposed rule(s) needing manager activation: ${proposedRuleIds.join(", ")}`,
            });
        }
    }
    return result;
}
//# sourceMappingURL=migrateLegacyVendorIgnoreRules.js.map