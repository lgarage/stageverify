"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VENDOR_IGNORE_RULES_COLLECTION = void 0;
exports.isArmableVendorKey = isArmableVendorKey;
exports.getVendorIgnoreRule = getVendorIgnoreRule;
exports.vendorIgnoresCreditReturns = vendorIgnoresCreditReturns;
exports.upsertVendorIgnoreRule = upsertVendorIgnoreRule;
exports.listVendorIgnoreRules = listVendorIgnoreRules;
exports.deleteVendorIgnoreRule = deleteVendorIgnoreRule;
const vendorTrainingMd_1 = require("./vendorTrainingMd");
exports.VENDOR_IGNORE_RULES_COLLECTION = "vendorInvoiceIgnoreRules";
function isArmableVendorKey(raw) {
    const key = (0, vendorTrainingMd_1.sanitizeVendorKey)(raw);
    return key !== "unknown-vendor" && key.length > 0;
}
async function getVendorIgnoreRule(db, vendorKeyRaw) {
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKeyRaw);
    if (!isArmableVendorKey(vendorKey))
        return null;
    const snap = await db
        .collection(exports.VENDOR_IGNORE_RULES_COLLECTION)
        .doc(vendorKey)
        .get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return {
        vendorKey,
        ignoreCreditReturns: data.ignoreCreditReturns === true,
        taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
        taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
        ...(typeof data.sourceImportId === "string" && data.sourceImportId
            ? { sourceImportId: data.sourceImportId }
            : {}),
    };
}
async function vendorIgnoresCreditReturns(db, vendorKeyRaw) {
    const rule = await getVendorIgnoreRule(db, vendorKeyRaw);
    return rule?.ignoreCreditReturns === true;
}
async function upsertVendorIgnoreRule(db, input) {
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(input.vendorKey);
    if (!isArmableVendorKey(vendorKey)) {
        throw new Error("unknown_vendor_not_armable");
    }
    const now = new Date().toISOString();
    const existing = await getVendorIgnoreRule(db, vendorKey);
    const taughtAt = existing?.taughtAt || input.taughtAt || now;
    const taughtBy = existing?.taughtBy || input.uid;
    const doc = {
        vendorKey,
        ignoreCreditReturns: input.ignoreCreditReturns,
        taughtBy,
        taughtAt,
        updatedAt: now,
        updatedBy: input.uid,
        ...(input.sourceImportId
            ? { sourceImportId: input.sourceImportId }
            : existing?.sourceImportId
                ? { sourceImportId: existing.sourceImportId }
                : {}),
    };
    await db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).doc(vendorKey).set(doc, {
        merge: true,
    });
    return doc;
}
async function listVendorIgnoreRules(db) {
    const snap = await db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).get();
    const rows = [];
    for (const doc of snap.docs) {
        const data = doc.data();
        rows.push({
            vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(doc.id),
            ignoreCreditReturns: data.ignoreCreditReturns === true,
            taughtBy: typeof data.taughtBy === "string" ? data.taughtBy : "",
            taughtAt: typeof data.taughtAt === "string" ? data.taughtAt : "",
            updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
            updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
            ...(typeof data.sourceImportId === "string" && data.sourceImportId
                ? { sourceImportId: data.sourceImportId }
                : {}),
        });
    }
    rows.sort((a, b) => a.vendorKey.localeCompare(b.vendorKey));
    return rows;
}
async function deleteVendorIgnoreRule(db, vendorKeyRaw) {
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKeyRaw);
    if (!isArmableVendorKey(vendorKey)) {
        return { deleted: false };
    }
    const ref = db.collection(exports.VENDOR_IGNORE_RULES_COLLECTION).doc(vendorKey);
    const snap = await ref.get();
    if (!snap.exists)
        return { deleted: false };
    await ref.delete();
    return { deleted: true };
}
//# sourceMappingURL=vendorIgnoreRules.js.map