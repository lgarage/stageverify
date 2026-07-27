"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveVendorTrainingPlaybook = exports.getVendorTrainingPlaybook = exports.saveInvoiceTrainingLesson = exports.configureInvoiceTrainingAdmin = exports.getInvoiceTrainingAdminStatus = void 0;
/**
 * Invoice training Admin — configure alert email/password, Save lesson, MD editor.
 * Password hash in invoiceTrainingAdminSecrets (CF-only). Never in public appSettings.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const adminConfig_1 = require("./invoice/aiShadow/adminConfig");
const vendorTrainingMd_1 = require("./invoice/aiShadow/vendorTrainingMd");
const saveTrainingLessonCore_1 = require("./invoice/aiShadow/saveTrainingLessonCore");
function getDb() {
    return admin.firestore();
}
async function requirePassword(data) {
    const password = (0, adminConfig_1.asAdminPassword)(data?.password);
    if (!password) {
        throw new https_1.HttpsError("invalid-argument", `Admin password required (${8}–${128} characters).`);
    }
    try {
        const ok = await (0, adminConfig_1.verifyAdminPassword)(password);
        if (!ok) {
            throw new https_1.HttpsError("permission-denied", "Incorrect Admin password.");
        }
    }
    catch (err) {
        if (err instanceof adminConfig_1.AdminPasswordLockedError) {
            throw new https_1.HttpsError("resource-exhausted", err.message);
        }
        throw err;
    }
}
exports.getInvoiceTrainingAdminStatus = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const status = await (0, adminConfig_1.isAdminFullyConfigured)();
    return {
        alertEmailConfigured: status.alertEmailConfigured,
        passwordConfigured: status.passwordConfigured,
        fullyConfigured: status.alertEmailConfigured && status.passwordConfigured,
        alertEmail: status.alertEmail,
    };
});
exports.configureInvoiceTrainingAdmin = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const alertEmail = (0, adminConfig_1.asAlertEmail)(data.alertEmail);
    if (!alertEmail) {
        throw new https_1.HttpsError("invalid-argument", "A valid alert email is required.");
    }
    const password = (0, adminConfig_1.asAdminPassword)(data.password);
    if (!password) {
        throw new https_1.HttpsError("invalid-argument", "Admin password must be 8–128 characters.");
    }
    await (0, adminConfig_1.storeAdminConfig)({ alertEmail, password });
    return {
        success: true,
        alertEmailConfigured: true,
        passwordConfigured: true,
        fullyConfigured: true,
        alertEmail,
    };
});
exports.saveInvoiceTrainingLesson = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    const correctionNote = typeof data.correctionNote === "string" ? data.correctionNote : "";
    if (!correctionNote.trim()) {
        throw new https_1.HttpsError("invalid-argument", "Training note is required to save a lesson.");
    }
    const importRef = getDb().collection("vendorInvoiceImports").doc(importId);
    const snap = await importRef.get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Invoice import not found.");
    }
    const importDoc = snap.data();
    const vendorKey = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
    const now = new Date().toISOString();
    const result = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
        vendorKey,
        correctionNoteRaw: correctionNote,
        importId,
        atIso: now,
    });
    if (result.trainingLessonWrote) {
        await importRef.update({
            trainingLessonAppendedAt: now,
            updatedAt: now,
        });
    }
    return {
        vendorInvoiceImportId: importId,
        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKey),
        ...result,
    };
});
exports.getVendorTrainingPlaybook = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    await requirePassword(request.data);
    const data = (request.data ?? {});
    let vendorKeyRaw = "";
    if (typeof data.vendorKey === "string" && data.vendorKey.trim()) {
        vendorKeyRaw = data.vendorKey.trim();
    }
    else if (typeof data.vendorInvoiceImportId === "string" &&
        data.vendorInvoiceImportId.trim()) {
        const snap = await getDb()
            .collection("vendorInvoiceImports")
            .doc(data.vendorInvoiceImportId.trim())
            .get();
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Invoice import not found.");
        }
        vendorKeyRaw = (0, adminConfig_1.vendorKeyFromImportDoc)(snap.data());
    }
    else {
        throw new https_1.HttpsError("invalid-argument", "vendorKey or vendorInvoiceImportId is required.");
    }
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKeyRaw);
    const markdown = await (0, vendorTrainingMd_1.readVendorTrainingMd)(vendorKey);
    return { vendorKey, markdown };
});
exports.saveVendorTrainingPlaybook = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    await requirePassword(request.data);
    const data = (request.data ?? {});
    const vendorKeyRaw = typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
    if (!vendorKeyRaw) {
        throw new https_1.HttpsError("invalid-argument", "vendorKey is required.");
    }
    const markdown = typeof data.markdown === "string" ? data.markdown : "";
    const vendorKey = (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKeyRaw);
    const result = await (0, vendorTrainingMd_1.writeVendorTrainingMd)({ vendorKey, markdown });
    if (!result.wrote) {
        throw new https_1.HttpsError("invalid-argument", result.reason === "md_size_cap"
            ? "Playbook exceeds size limit."
            : "Playbook markdown is empty.");
    }
    return { vendorKey, wrote: true };
});
//# sourceMappingURL=invoiceTrainingAdminApi.js.map