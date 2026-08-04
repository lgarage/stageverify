"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVendorIgnoreRuleCallable = exports.updateVendorIgnoreRuleCallable = exports.listVendorIgnoreRulesCallable = exports.confirmVendorIgnoreRule = exports.proposeVendorIgnoreRule = exports.saveVendorTrainingPlaybook = exports.getVendorTrainingPlaybook = exports.saveInvoiceTrainingLesson = exports.configureInvoiceTrainingAdmin = exports.getInvoiceTrainingAdminStatus = void 0;
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
const creditReturnSkip_1 = require("./invoice/creditReturnSkip");
const vendorIgnoreRules_1 = require("./invoice/aiShadow/vendorIgnoreRules");
const vendorIgnoreEcho_1 = require("./invoice/vendorIgnoreEcho");
const inferDocumentType_1 = require("./invoice/inferDocumentType");
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
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
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
    const applyNowDismiss = importDoc.reviewStatus === "pending_review" &&
        (0, creditReturnSkip_1.shouldApplyNowDismissCreditImport)(correctionNote, importDoc);
    const result = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
        vendorKey,
        correctionNoteRaw: correctionNote,
        importId,
        atIso: now,
    });
    let importDismissed = false;
    let reviewStatus = importDoc.reviewStatus ?? "pending_review";
    if (result.trainingLessonWrote && applyNowDismiss) {
        await getDb().runTransaction(async (tx) => {
            const freshSnap = await tx.get(importRef);
            if (!freshSnap.exists) {
                throw new https_1.HttpsError("not-found", "Invoice import not found.");
            }
            const fresh = freshSnap.data();
            if (fresh.reviewStatus !== "pending_review") {
                return;
            }
            tx.update(importRef, {
                reviewStatus: "rejected",
                skipReason: creditReturnSkip_1.CREDIT_RETURN_SKIP_REASON,
                rejectedAt: now,
                rejectedBy: uid,
                trainingLessonAppendedAt: now,
                updatedAt: now,
            });
            importDismissed = true;
        });
        if (importDismissed) {
            reviewStatus = "rejected";
        }
    }
    else if (result.trainingLessonWrote) {
        await importRef.update({
            trainingLessonAppendedAt: now,
            updatedAt: now,
        });
    }
    return {
        vendorInvoiceImportId: importId,
        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKey),
        importDismissed,
        reviewStatus,
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
function parseFingerprintFromAdminData(data) {
    if (typeof data.ruleId === "string" && data.ruleId.includes("__")) {
        const parts = data.ruleId.split("__");
        if (parts.length >= 3) {
            const documentType = parts[parts.length - 1];
            const parserFormatId = (0, inferDocumentType_1.normalizeParserFormatId)(parts[parts.length - 2]);
            const vendorKey = parts.slice(0, parts.length - 2).join("__");
            if (documentType === "sales_order_confirmation" ||
                documentType === "invoice" ||
                documentType === "credit_memo" ||
                documentType === "unknown") {
                return {
                    vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKey),
                    parserFormatId,
                    documentType,
                };
            }
        }
    }
    const vendorKeyRaw = typeof data.vendorKey === "string" ? data.vendorKey.trim() : "";
    const documentType = data.documentType;
    if (!vendorKeyRaw ||
        (documentType !== "sales_order_confirmation" &&
            documentType !== "invoice" &&
            documentType !== "credit_memo" &&
            documentType !== "unknown")) {
        return null;
    }
    return {
        vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(vendorKeyRaw),
        parserFormatId: (0, inferDocumentType_1.normalizeParserFormatId)(data.parserFormatId),
        documentType,
    };
}
async function loadImportForIgnoreRule(importId) {
    const importRef = getDb().collection("vendorInvoiceImports").doc(importId);
    const snap = await importRef.get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Invoice import not found.");
    }
    return {
        ref: importRef,
        doc: snap.data(),
    };
}
async function senderDomainsForImport(importDoc) {
    const inboundId = importDoc.inboundEmailProcessingId?.trim();
    if (!inboundId) {
        throw new https_1.HttpsError("failed-precondition", "Cannot propose an ignore rule — source email is not linked to this import.");
    }
    const inboundSnap = await getDb()
        .collection("inboundEmailProcessing")
        .doc(inboundId)
        .get();
    if (!inboundSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "Cannot propose an ignore rule — source email record is missing.");
    }
    const senderEmail = typeof inboundSnap.data()?.senderEmail === "string"
        ? inboundSnap.data().senderEmail
        : "";
    const domain = (0, vendorIgnoreEcho_1.extractSenderDomain)(senderEmail);
    if (!domain) {
        throw new https_1.HttpsError("failed-precondition", "Cannot propose an ignore rule — sender email domain is unavailable.");
    }
    return [domain];
}
function vendorLabelFromImport(importDoc) {
    if (typeof importDoc.detectedVendorName === "string" &&
        importDoc.detectedVendorName.trim()) {
        return importDoc.detectedVendorName.trim();
    }
    if (importDoc.parserFormatId === "johnstone")
        return "Johnstone";
    return importDoc.parserFormatId ?? "this vendor";
}
/**
 * Teach-chat propose: server computes fingerprint + echo + echoToken.
 * Rejects unknown type/format, invoice type, unknown-vendor (D-59 P1).
 */
exports.proposeVendorIgnoreRule = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    const { doc: importDoc } = await loadImportForIgnoreRule(importId);
    const vendorKeyRaw = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
    const fingerprint = (0, vendorIgnoreRules_1.fingerprintFromImport)({
        vendorKey: vendorKeyRaw,
        parserFormatId: importDoc.parserFormatId,
        importRow: importDoc,
    });
    const rejectReason = (0, vendorIgnoreEcho_1.armableFingerprintError)(fingerprint);
    if (rejectReason) {
        throw new https_1.HttpsError("failed-precondition", rejectReason);
    }
    const senderDomains = await senderDomainsForImport(importDoc);
    const importUpdatedAt = typeof importDoc.updatedAt === "string" && importDoc.updatedAt.trim()
        ? importDoc.updatedAt.trim()
        : "";
    if (!importUpdatedAt) {
        throw new https_1.HttpsError("failed-precondition", "Cannot propose an ignore rule — import record is missing a timestamp.");
    }
    const echoToken = (0, vendorIgnoreEcho_1.computeEchoToken)({
        importId,
        vendorKey: fingerprint.vendorKey,
        parserFormatId: fingerprint.parserFormatId,
        documentType: fingerprint.documentType,
        senderDomains,
        importUpdatedAt,
    });
    const echoText = (0, vendorIgnoreEcho_1.buildProposeEchoText)({
        fingerprint,
        vendorLabel: vendorLabelFromImport(importDoc),
        senderDomains,
    });
    return {
        echoText,
        echoToken,
        fingerprint,
        senderDomains,
    };
});
/**
 * Teach-chat consent: dispatcher confirms "yes" after server echo → arm ignore rule in Firestore.
 * Requires valid echoToken bound to import content (D-59 P1).
 * Fingerprint is recomputed server-side from the import (not client-trusted).
 * SAFETY: only writes vendorInvoiceIgnoreRules + may reject the current import in
 * vendorInvoiceImports — never touches deliveries, items, or auto-approves.
 */
exports.confirmVendorIgnoreRule = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 200) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (data.confirm !== true) {
        throw new https_1.HttpsError("invalid-argument", "confirm must be true after the teach-chat echo.");
    }
    const echoToken = typeof data.echoToken === "string" ? data.echoToken.trim() : "";
    if (!echoToken) {
        throw new https_1.HttpsError("failed-precondition", "echoToken is required — propose the rule again to get a fresh echo.");
    }
    const { ref: importRef, doc: importDoc } = await loadImportForIgnoreRule(importId);
    const vendorKeyRaw = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
    const fingerprint = (0, vendorIgnoreRules_1.fingerprintFromImport)({
        vendorKey: vendorKeyRaw,
        parserFormatId: importDoc.parserFormatId,
        importRow: importDoc,
    });
    const rejectReason = (0, vendorIgnoreEcho_1.armableFingerprintError)(fingerprint);
    if (rejectReason) {
        throw new https_1.HttpsError("failed-precondition", rejectReason);
    }
    const senderDomains = await senderDomainsForImport(importDoc);
    const importUpdatedAt = typeof importDoc.updatedAt === "string" && importDoc.updatedAt.trim()
        ? importDoc.updatedAt.trim()
        : "";
    if (!importUpdatedAt) {
        throw new https_1.HttpsError("failed-precondition", "Cannot confirm — import record is missing a timestamp. Propose again.");
    }
    const expectedToken = (0, vendorIgnoreEcho_1.computeEchoToken)({
        importId,
        vendorKey: fingerprint.vendorKey,
        parserFormatId: fingerprint.parserFormatId,
        documentType: fingerprint.documentType,
        senderDomains,
        importUpdatedAt,
    });
    if (echoToken !== expectedToken) {
        throw new https_1.HttpsError("failed-precondition", "This import changed since the echo — propose the rule again to confirm.");
    }
    let rule;
    try {
        rule = await (0, vendorIgnoreRules_1.upsertVendorIgnoreRule)(getDb(), {
            fingerprint,
            enabled: true,
            uid,
            sourceImportId: importId,
        });
    }
    catch (err) {
        if (err instanceof Error && err.message === "fingerprint_not_armable") {
            throw new https_1.HttpsError("failed-precondition", (0, vendorIgnoreEcho_1.armableFingerprintError)(fingerprint) ??
                "This document type cannot be used for an ignore rule.");
        }
        throw err;
    }
    const now = new Date().toISOString();
    let importDismissed = false;
    let reviewStatus = importDoc.reviewStatus ?? "pending_review";
    if (importDoc.reviewStatus === "pending_review") {
        const skip = (0, creditReturnSkip_1.documentIgnoreSkipFields)(now);
        await getDb().runTransaction(async (tx) => {
            const freshSnap = await tx.get(importRef);
            if (!freshSnap.exists) {
                throw new https_1.HttpsError("not-found", "Invoice import not found.");
            }
            const fresh = freshSnap.data();
            if (fresh.reviewStatus !== "pending_review") {
                return;
            }
            tx.update(importRef, {
                ...skip,
                rejectedBy: skip.rejectedBy,
            });
            importDismissed = true;
        });
        if (importDismissed) {
            reviewStatus = "rejected";
        }
    }
    return {
        vendorKey: rule.vendorKey,
        ignoreCreditReturns: rule.documentType === "credit_memo" && rule.enabled,
        importDismissed,
        reviewStatus,
        rule,
        echoSummary: `Skip future ${(0, inferDocumentType_1.documentTypeLabel)(rule.documentType)} for ${rule.vendorKey} (${rule.parserFormatId})`,
    };
});
/** Admin password-gated list of Firestore ignore rules. */
exports.listVendorIgnoreRulesCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    await requirePassword(request.data);
    const rules = await (0, vendorIgnoreRules_1.listVendorIgnoreRules)(getDb());
    return {
        rules: rules.map((r) => ({
            ...r,
            ruleId: (0, vendorIgnoreRules_1.ignoreRuleDocId)(r),
            ignoreCreditReturns: r.documentType === "credit_memo" && r.enabled,
        })),
    };
});
/** Admin password-gated update (toggle) of a Firestore ignore rule. */
exports.updateVendorIgnoreRuleCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    await requirePassword(request.data);
    const data = (request.data ?? {});
    let fingerprint = parseFingerprintFromAdminData(data);
    // Legacy toggle: vendorKey + ignoreCreditReturns only → credit_memo
    if (!fingerprint &&
        typeof data.vendorKey === "string" &&
        typeof data.ignoreCreditReturns === "boolean") {
        fingerprint = {
            vendorKey: (0, vendorTrainingMd_1.sanitizeVendorKey)(data.vendorKey),
            parserFormatId: "johnstone",
            documentType: "credit_memo",
        };
    }
    if (!fingerprint || !(0, vendorIgnoreRules_1.isArmableFingerprint)(fingerprint)) {
        throw new https_1.HttpsError("invalid-argument", fingerprint
            ? ((0, vendorIgnoreEcho_1.armableFingerprintError)(fingerprint) ??
                "This document type cannot be used for an ignore rule.")
            : "A valid rule fingerprint (vendorKey + documentType) or ruleId is required.");
    }
    const enabled = typeof data.enabled === "boolean"
        ? data.enabled
        : typeof data.ignoreCreditReturns === "boolean"
            ? data.ignoreCreditReturns
            : true;
    const rule = await (0, vendorIgnoreRules_1.upsertVendorIgnoreRule)(getDb(), {
        fingerprint,
        enabled,
        uid,
    });
    return {
        rule: {
            ...rule,
            ruleId: (0, vendorIgnoreRules_1.ignoreRuleDocId)(rule),
            ignoreCreditReturns: rule.documentType === "credit_memo" && rule.enabled,
        },
    };
});
/** Admin password-gated delete of a Firestore ignore rule. */
exports.deleteVendorIgnoreRuleCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    await requirePassword(request.data);
    const data = (request.data ?? {});
    const fingerprint = parseFingerprintFromAdminData(data);
    if (fingerprint && (0, vendorIgnoreRules_1.isArmableVendorKey)(fingerprint.vendorKey)) {
        const result = await (0, vendorIgnoreRules_1.deleteVendorIgnoreRuleByFingerprint)(getDb(), fingerprint);
        return {
            vendorKey: fingerprint.vendorKey,
            ruleId: (0, vendorIgnoreRules_1.ignoreRuleDocId)(fingerprint),
            ...result,
        };
    }
    throw new https_1.HttpsError("invalid-argument", "A valid ruleId or vendorKey + documentType is required.");
});
//# sourceMappingURL=invoiceTrainingAdminApi.js.map