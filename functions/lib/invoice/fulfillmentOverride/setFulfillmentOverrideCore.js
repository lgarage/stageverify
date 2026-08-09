"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FulfillmentOverrideInputError = void 0;
exports.runSetInvoiceReviewFulfillmentOverrideCore = runSetInvoiceReviewFulfillmentOverrideCore;
const inferImportStatus_1 = require("../inferImportStatus");
const parsedHeaderValidation_1 = require("../parsedHeaderValidation");
const reconcileAfterFieldCorrection_1 = require("../reviewChat/reconcileAfterFieldCorrection");
const REVIEW_COLLECTION = "vendorInvoiceImports";
class FulfillmentOverrideInputError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "FulfillmentOverrideInputError";
        this.code = code;
    }
}
exports.FulfillmentOverrideInputError = FulfillmentOverrideInputError;
function isoNow() {
    return new Date().toISOString();
}
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function headerFulfillmentMethod(parsedHeader) {
    const fm = parsedHeader.fulfillmentMethod;
    return fm === "delivery" ||
        fm === "will_call_pickup" ||
        fm === "unknown"
        ? fm
        : undefined;
}
function buildParsedForDeriveStatus(importDoc, parsedHeader) {
    const parseWarnings = Array.isArray(importDoc.parseWarnings)
        ? importDoc.parseWarnings
        : [];
    const parsedLines = Array.isArray(importDoc.parsedLines)
        ? importDoc.parsedLines
        : [];
    let header;
    try {
        header = (0, parsedHeaderValidation_1.asParsedHeaderForImport)(parsedHeader);
    }
    catch {
        const fm = (headerFulfillmentMethod(parsedHeader) ??
            "unknown");
        header = {
            ...parsedHeader,
            fulfillmentMethod: fm,
        };
    }
    return {
        header,
        lines: parsedLines,
        parseWarnings,
        orderNotes: Array.isArray(importDoc.orderNotes)
            ? importDoc.orderNotes
            : [],
    };
}
function maybeRecomputeImportStatus(currentStatus, importDoc, parsedHeader) {
    if (currentStatus !== "pickup_at_vendor")
        return currentStatus;
    const formatId = importDoc.parserFormatId === "johnstone" ||
        importDoc.parserFormatId === "first_supply" ||
        importDoc.parserFormatId === "generic" ||
        importDoc.parserFormatId === "unknown"
        ? importDoc.parserFormatId
        : "johnstone";
    const parsed = buildParsedForDeriveStatus(importDoc, parsedHeader);
    return (0, inferImportStatus_1.deriveImportStatus)(parsed, formatId);
}
function resultFromDoc(importId, importDoc, parsedHeader, importStatus, previousImportStatus, fulfillmentOverride, applied, alreadyApplied) {
    const reconciled = (0, reconcileAfterFieldCorrection_1.reconcileImportStateAfterCorrection)({
        parsedHeader,
        parseWarnings: importDoc.parseWarnings,
        importStatus,
        confidenceScore: importDoc.confidenceScore,
        humanReviewRequired: importDoc.humanReviewRequired,
        duplicate: importDoc.duplicate,
        parsedLines: importDoc.parsedLines,
        parsedLineCount: importDoc.parsedLineCount,
        pageId: importDoc.pageId,
        parserFormatId: importDoc.parserFormatId,
        orderNotes: importDoc.orderNotes,
        fieldCorrectionLog: importDoc.fieldCorrectionLog,
    });
    return {
        vendorInvoiceImportId: importId,
        applied,
        alreadyApplied,
        parsedHeader: reconciled.parsedHeader,
        importStatus,
        previousImportStatus,
        fulfillmentOverride,
        reviewStatus: typeof importDoc.reviewStatus === "string" ? importDoc.reviewStatus : "",
        parseWarnings: reconciled.parseWarnings,
        autoImportEligible: reconciled.autoImportEligible,
        autoImportConfidence: reconciled.autoImportConfidence,
        autoImportReasons: reconciled.autoImportReasons,
        reviewRequiredReasons: reconciled.reviewRequiredReasons,
        importDecisionMode: reconciled.importDecisionMode,
        suggestedAction: reconciled.suggestedAction,
    };
}
function parseActiveOverride(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const o = raw;
    if (o.active !== true)
        return null;
    if (o.fromMethod !== "will_call_pickup" || o.toMethod !== "delivery")
        return null;
    const at = typeof o.at === "string" ? o.at : "";
    const by = typeof o.by === "string" ? o.by : "";
    if (!at || !by)
        return null;
    return {
        active: true,
        fromMethod: "will_call_pickup",
        toMethod: "delivery",
        at,
        by,
    };
}
async function runSetInvoiceReviewFulfillmentOverrideCore(input) {
    const importId = input.vendorInvoiceImportId.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!importId || importId.length > 256) {
        throw new FulfillmentOverrideInputError("invalid-argument", "Invalid vendorInvoiceImportId.");
    }
    if (!idempotencyKey || idempotencyKey.length > 200) {
        throw new FulfillmentOverrideInputError("invalid-argument", "Invalid idempotencyKey.");
    }
    if (input.toFulfillmentMethod !== "delivery") {
        throw new FulfillmentOverrideInputError("invalid-argument", "toFulfillmentMethod must be delivery.");
    }
    const importRef = input.db.collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new FulfillmentOverrideInputError("not-found", "Invoice import not found.");
    }
    const importDoc = importSnap.data();
    const reviewStatus = importDoc.reviewStatus;
    if (reviewStatus !== "pending_review") {
        throw new FulfillmentOverrideInputError("failed-precondition", "import_not_pending_review");
    }
    const parsedHeader = asRecord(importDoc.parsedHeader);
    const currentMethod = headerFulfillmentMethod(parsedHeader);
    const existingOverride = parseActiveOverride(importDoc.fulfillmentOverride);
    if (existingOverride) {
        return resultFromDoc(importId, importDoc, parsedHeader, typeof importDoc.importStatus === "string" ? importDoc.importStatus : "pending", typeof importDoc.importStatus === "string" ? importDoc.importStatus : "pending", existingOverride, false, true);
    }
    if (currentMethod !== "will_call_pickup") {
        throw new FulfillmentOverrideInputError("failed-precondition", "fulfillment_override_requires_will_call");
    }
    const appliedAt = isoNow();
    const previousImportStatus = typeof importDoc.importStatus === "string" && importDoc.importStatus.trim()
        ? importDoc.importStatus
        : "pending";
    const fulfillmentOverride = {
        active: true,
        fromMethod: "will_call_pickup",
        toMethod: "delivery",
        at: appliedAt,
        by: input.uid,
    };
    const nextHeader = {
        ...parsedHeader,
        fulfillmentMethod: "delivery",
    };
    const updatePayload = {
        "parsedHeader.fulfillmentMethod": "delivery",
        fulfillmentOverride,
        updatedAt: appliedAt,
    };
    if (!importDoc.originalParsedHeader) {
        updatePayload.originalParsedHeader = { ...parsedHeader };
    }
    const nextImportStatus = maybeRecomputeImportStatus(previousImportStatus, importDoc, nextHeader);
    updatePayload.importStatus = nextImportStatus;
    const reconciled = (0, reconcileAfterFieldCorrection_1.reconcileImportStateAfterCorrection)({
        parsedHeader: nextHeader,
        parseWarnings: importDoc.parseWarnings,
        importStatus: nextImportStatus,
        confidenceScore: importDoc.confidenceScore,
        humanReviewRequired: importDoc.humanReviewRequired,
        duplicate: importDoc.duplicate,
        parsedLines: importDoc.parsedLines,
        parsedLineCount: importDoc.parsedLineCount,
        pageId: importDoc.pageId,
        parserFormatId: importDoc.parserFormatId,
        orderNotes: importDoc.orderNotes,
        fieldCorrectionLog: importDoc.fieldCorrectionLog,
    });
    updatePayload.parseWarnings = reconciled.parseWarnings;
    updatePayload.autoImportEligible = reconciled.autoImportEligible;
    updatePayload.autoImportConfidence = reconciled.autoImportConfidence;
    updatePayload.autoImportReasons = reconciled.autoImportReasons;
    updatePayload.reviewRequiredReasons = reconciled.reviewRequiredReasons;
    updatePayload.importDecisionMode = reconciled.importDecisionMode;
    updatePayload.suggestedAction = reconciled.suggestedAction;
    await importRef.update(updatePayload);
    const mergedDoc = {
        ...importDoc,
        parsedHeader: nextHeader,
        importStatus: nextImportStatus,
        fulfillmentOverride,
        parseWarnings: reconciled.parseWarnings,
        autoImportEligible: reconciled.autoImportEligible,
        autoImportConfidence: reconciled.autoImportConfidence,
        autoImportReasons: reconciled.autoImportReasons,
        reviewRequiredReasons: reconciled.reviewRequiredReasons,
        importDecisionMode: reconciled.importDecisionMode,
        suggestedAction: reconciled.suggestedAction,
        originalParsedHeader: importDoc.originalParsedHeader ?? updatePayload.originalParsedHeader,
    };
    return resultFromDoc(importId, mergedDoc, nextHeader, nextImportStatus, previousImportStatus, fulfillmentOverride, true, false);
}
//# sourceMappingURL=setFulfillmentOverrideCore.js.map