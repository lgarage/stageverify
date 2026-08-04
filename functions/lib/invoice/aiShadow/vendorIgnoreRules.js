"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VENDOR_IGNORE_RULES_COLLECTION = void 0;
exports.isArmableVendorKey = isArmableVendorKey;
exports.isArmableFingerprint = isArmableFingerprint;
exports.ignoreRuleDocId = ignoreRuleDocId;
exports.fingerprintFromImport = fingerprintFromImport;
exports.getVendorIgnoreRuleById = getVendorIgnoreRuleById;
exports.vendorIgnoresFingerprint = vendorIgnoresFingerprint;
exports.upsertVendorIgnoreRule = upsertVendorIgnoreRule;
exports.activateVendorIgnoreRuleDoc = activateVendorIgnoreRuleDoc;
exports.disableVendorIgnoreRuleDoc = disableVendorIgnoreRuleDoc;
exports.archiveVendorIgnoreRuleDoc = archiveVendorIgnoreRuleDoc;
exports.listVendorIgnoreRules = listVendorIgnoreRules;
exports.deleteVendorIgnoreRule = deleteVendorIgnoreRule;
exports.deleteVendorIgnoreRuleByFingerprint = deleteVendorIgnoreRuleByFingerprint;
const vendorTrainingMd_1 = require("./vendorTrainingMd");
const inferDocumentType_1 = require("../inferDocumentType");
exports.VENDOR_IGNORE_RULES_COLLECTION = "vendorInvoiceIgnoreRules";
function isArmableVendorKey(raw) {
    const key = (0, vendorTrainingMd_1.sanitizeVendorKey)(raw);
    return key !== "unknown-vendor" && key.length > 0;
}
/** Never-unknown + non-invoice enforcement (D-59 P1). */
function isArmableFingerprint(fp) {
    if (!isArmableVendorKey(fp.vendorKey))
        return false;
    if (fp.parserFormatId === "unknown")
        return false;
    if (fp.documentType === "unknown" || fp.documentType === "invoice") {
        return false;
    }
    return (fp.documentType === "sales_order_confirmation" ||
        fp.documentType === "credit_memo");
}
function ignoreRuleDocId(fp) {
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(fp.vendorKey);
    const format = (0, inferDocumentType_1.normalizeParserFormatId)(fp.parserFormatId);
    const docType = fp.documentType || "unknown";
    return `${vendorKey}__${format}__${docType}`;
}
function fingerprintFromImport(input) {
    return {
        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey),
        parserFormatId: (0, inferDocumentType_1.normalizeParserFormatId)(input.parserFormatId),
        documentType: (0, inferDocumentType_1.inferDocumentType)(input.importRow),
    };
}
function resolveStatusFromLegacy(data, legacyEnabled) {
    const raw = data.status;
    if (raw === "proposed" ||
        raw === "active" ||
        raw === "disabled" ||
        raw === "archived") {
        return raw;
    }
    return legacyEnabled ? "active" : "disabled";
}
function normalizeRuleDoc(docId, data) {
    // Legacy: doc id was vendorKey only with ignoreCreditReturns boolean.
    const legacyCredit = data.ignoreCreditReturns === true &&
        typeof data.documentType !== "string";
    let vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(typeof data.vendorKey === "string" ? data.vendorKey : docId.split("__")[0] ?? docId);
    let parserFormatId = (0, inferDocumentType_1.normalizeParserFormatId)(data.parserFormatId);
    let documentType = data.documentType === "sales_order_confirmation" ||
        data.documentType === "invoice" ||
        data.documentType === "credit_memo" ||
        data.documentType === "unknown"
        ? data.documentType
        : "unknown";
    if (legacyCredit) {
        vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(typeof data.vendorKey === "string" ? data.vendorKey : docId);
        parserFormatId =
            vendorKey.includes("first") || vendorKey.includes("1supply")
                ? "first_supply"
                : "johnstone";
        documentType = "credit_memo";
    }
    if (!isArmableVendorKey(vendorKey))
        return null;
    const legacyEnabled = typeof data.enabled === "boolean"
        ? data.enabled
        : legacyCredit
            ? true
            : data.ignoreCreditReturns === true;
    const status = resolveStatusFromLegacy(data, legacyEnabled);
    const enabled = status === "active";
    const fp = {
        vendorKey,
        parserFormatId,
        documentType,
    };
    return {
        ...fp,
        status,
        enabled,
        taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
        taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
        label: typeof data.label === "string" && data.label.trim()
            ? data.label.trim()
            : `${(0, inferDocumentType_1.documentTypeLabel)(documentType)} · ${parserFormatId}`,
        ...(typeof data.sourceImportId === "string" && data.sourceImportId
            ? { sourceImportId: data.sourceImportId }
            : {}),
        ...(legacyCredit ? { ignoreCreditReturns: true } : {}),
        ...(typeof data.proposedBy === "string" && data.proposedBy
            ? { proposedBy: data.proposedBy }
            : {}),
        ...(typeof data.proposedAt === "string" && data.proposedAt
            ? { proposedAt: data.proposedAt }
            : {}),
        ...(typeof data.activatedBy === "string" && data.activatedBy
            ? { activatedBy: data.activatedBy }
            : {}),
        ...(typeof data.activatedAt === "string" && data.activatedAt
            ? { activatedAt: data.activatedAt }
            : {}),
        ...(typeof data.disabledBy === "string" && data.disabledBy
            ? { disabledBy: data.disabledBy }
            : {}),
        ...(typeof data.disabledAt === "string" && data.disabledAt
            ? { disabledAt: data.disabledAt }
            : {}),
        ...(typeof data.disabledReason === "string" && data.disabledReason
            ? { disabledReason: data.disabledReason }
            : {}),
        ...(typeof data.archivedBy === "string" && data.archivedBy
            ? { archivedBy: data.archivedBy }
            : {}),
        ...(typeof data.archivedAt === "string" && data.archivedAt
            ? { archivedAt: data.archivedAt }
            : {}),
        ...(typeof data.archivedReason === "string" && data.archivedReason
            ? { archivedReason: data.archivedReason }
            : {}),
    };
}
async function getVendorIgnoreRuleById(db, ruleId) {
    const snap = await db
        .collection(exports.VENDOR_IGNORE_RULES_COLLECTION)
        .doc(ruleId)
        .get();
    if (!snap.exists)
        return null;
    return normalizeRuleDoc(snap.id, (snap.data() ?? {}));
}
async function vendorIgnoresFingerprint(db, fp) {
    if (!isArmableFingerprint(fp))
        return false;
    const id = ignoreRuleDocId(fp);
    const rule = await getVendorIgnoreRuleById(db, id);
    if (rule?.status === "active")
        return true;
    // Legacy credit rule stored under vendorKey only.
    if (fp.documentType === "credit_memo") {
        const legacy = await getVendorIgnoreRuleById(db, (0, vendorTrainingMd_1.sanitizeVendorKey)(fp.vendorKey));
        if (legacy?.status === "active" && legacy.documentType === "credit_memo") {
            return true;
        }
    }
    return false;
}
async function upsertVendorIgnoreRule(db, input) {
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(input.fingerprint.vendorKey);
    const fingerprint = {
        vendorKey,
        parserFormatId: (0, inferDocumentType_1.normalizeParserFormatId)(input.fingerprint.parserFormatId),
        documentType: input.fingerprint.documentType || "unknown",
    };
    if (!isArmableFingerprint(fingerprint)) {
        throw new Error("fingerprint_not_armable");
    }
    const id = ignoreRuleDocId(fingerprint);
    const existing = await getVendorIgnoreRuleById(db, id);
    const now = new Date().toISOString();
    const taughtAt = existing?.taughtAt || input.taughtAt || now;
    const taughtBy = existing?.taughtBy || input.uid;
    const enabled = input.status === "active";
    const doc = {
        ...fingerprint,
        status: input.status,
        enabled,
        taughtBy,
        taughtAt,
        updatedAt: now,
        updatedBy: input.uid,
        label: `${(0, inferDocumentType_1.documentTypeLabel)(fingerprint.documentType)} · ${fingerprint.parserFormatId}`,
        ...(input.sourceImportId
            ? { sourceImportId: input.sourceImportId }
            : existing?.sourceImportId
                ? { sourceImportId: existing.sourceImportId }
                : {}),
        ...(input.proposedBy || existing?.proposedBy
            ? { proposedBy: input.proposedBy ?? existing.proposedBy }
            : {}),
        ...(input.proposedAt || existing?.proposedAt
            ? { proposedAt: input.proposedAt ?? existing.proposedAt }
            : {}),
        ...(input.activatedBy || existing?.activatedBy
            ? { activatedBy: input.activatedBy ?? existing.activatedBy }
            : {}),
        ...(input.activatedAt || existing?.activatedAt
            ? { activatedAt: input.activatedAt ?? existing.activatedAt }
            : {}),
        ...(input.disabledBy || existing?.disabledBy
            ? { disabledBy: input.disabledBy ?? existing.disabledBy }
            : {}),
        ...(input.disabledAt || existing?.disabledAt
            ? { disabledAt: input.disabledAt ?? existing.disabledAt }
            : {}),
        ...(input.disabledReason || existing?.disabledReason
            ? { disabledReason: input.disabledReason ?? existing.disabledReason }
            : {}),
        ...(input.archivedBy || existing?.archivedBy
            ? { archivedBy: input.archivedBy ?? existing.archivedBy }
            : {}),
        ...(input.archivedAt || existing?.archivedAt
            ? { archivedAt: input.archivedAt ?? existing.archivedAt }
            : {}),
        ...(input.archivedReason || existing?.archivedReason
            ? { archivedReason: input.archivedReason ?? existing.archivedReason }
            : {}),
    };
    await db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).doc(id).set(doc, {
        merge: true,
    });
    return doc;
}
async function activateVendorIgnoreRuleDoc(db, input) {
    const existing = await getVendorIgnoreRuleById(db, ignoreRuleDocId(input.fingerprint));
    if (!existing) {
        throw new Error("rule_not_found");
    }
    if (existing.status === "archived") {
        throw new Error("rule_archived");
    }
    const now = new Date().toISOString();
    return upsertVendorIgnoreRule(db, {
        fingerprint: input.fingerprint,
        status: "active",
        uid: input.uid,
        activatedBy: input.uid,
        activatedAt: now,
        sourceImportId: existing.sourceImportId,
        taughtAt: existing.taughtAt,
        proposedBy: existing.proposedBy,
        proposedAt: existing.proposedAt,
    });
}
async function disableVendorIgnoreRuleDoc(db, input) {
    const existing = await getVendorIgnoreRuleById(db, ignoreRuleDocId(input.fingerprint));
    if (!existing) {
        throw new Error("rule_not_found");
    }
    if (existing.status === "archived") {
        throw new Error("rule_archived");
    }
    const now = new Date().toISOString();
    return upsertVendorIgnoreRule(db, {
        fingerprint: input.fingerprint,
        status: "disabled",
        uid: input.uid,
        disabledBy: input.uid,
        disabledAt: now,
        disabledReason: "manual",
        sourceImportId: existing.sourceImportId,
        taughtAt: existing.taughtAt,
        proposedBy: existing.proposedBy,
        proposedAt: existing.proposedAt,
        activatedBy: existing.activatedBy,
        activatedAt: existing.activatedAt,
    });
}
async function archiveVendorIgnoreRuleDoc(db, input) {
    const existing = await getVendorIgnoreRuleById(db, ignoreRuleDocId(input.fingerprint));
    if (!existing) {
        throw new Error("rule_not_found");
    }
    const now = new Date().toISOString();
    return upsertVendorIgnoreRule(db, {
        fingerprint: input.fingerprint,
        status: "archived",
        uid: input.uid,
        archivedBy: input.uid,
        archivedAt: now,
        archivedReason: input.reason?.trim() || "manual",
        sourceImportId: existing.sourceImportId,
        taughtAt: existing.taughtAt,
        proposedBy: existing.proposedBy,
        proposedAt: existing.proposedAt,
        activatedBy: existing.activatedBy,
        activatedAt: existing.activatedAt,
        disabledBy: existing.disabledBy,
        disabledAt: existing.disabledAt,
        disabledReason: existing.disabledReason,
    });
}
async function listVendorIgnoreRules(db) {
    const snap = await db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).get();
    const rows = [];
    const seen = new Set();
    for (const docSnap of snap.docs) {
        const rule = normalizeRuleDoc(docSnap.id, (docSnap.data() ?? {}));
        if (!rule)
            continue;
        const id = ignoreRuleDocId(rule);
        if (seen.has(id))
            continue;
        seen.add(id);
        rows.push(rule);
    }
    rows.sort((a, b) => {
        const statusOrder = (s) => {
            if (s === "proposed")
                return 0;
            if (s === "active")
                return 1;
            if (s === "disabled")
                return 2;
            return 3;
        };
        const so = statusOrder(a.status) - statusOrder(b.status);
        if (so !== 0)
            return so;
        const vk = a.vendorKey.localeCompare(b.vendorKey);
        if (vk !== 0)
            return vk;
        return a.documentType.localeCompare(b.documentType);
    });
    return rows;
}
/** @deprecated Prefer archiveVendorIgnoreRuleDoc — delete re-routed in D-59 P2. */
async function deleteVendorIgnoreRule(db, ruleIdOrVendorKey) {
    const raw = ruleIdOrVendorKey.trim();
    if (!raw)
        return { deleted: false };
    const candidates = [raw, (0, vendorTrainingMd_1.sanitizeVendorKey)(raw)];
    let deleted = false;
    for (const id of candidates) {
        const ref = db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).doc(id);
        const snap = await ref.get();
        if (snap.exists) {
            await ref.delete();
            deleted = true;
        }
    }
    return { deleted };
}
/** @deprecated Prefer archiveVendorIgnoreRuleDoc — delete re-routed in D-59 P2. */
async function deleteVendorIgnoreRuleByFingerprint(db, fp) {
    const id = ignoreRuleDocId(fp);
    const ref = db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
        if (fp.documentType === "credit_memo") {
            return deleteVendorIgnoreRule(db, fp.vendorKey);
        }
        return { deleted: false };
    }
    await ref.delete();
    return { deleted: true };
}
//# sourceMappingURL=vendorIgnoreRules.js.map