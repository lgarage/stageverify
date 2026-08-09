"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileParseWarningsForHeader = reconcileParseWarningsForHeader;
exports.applyFulfillmentOverrideToHeader = applyFulfillmentOverrideToHeader;
exports.applyFieldCorrectionLogToHeader = applyFieldCorrectionLogToHeader;
exports.reconcileImportStateAfterCorrection = reconcileImportStateAfterCorrection;
/**
 * Lane C C2 — reconcile current import state after allowlisted field corrections.
 * Clears resolved missing-field parseWarnings and recomputes eligibility from the
 * authoritative corrected header (does not invent UI-only values).
 */
const computeAutoImportEligibility_1 = require("../computeAutoImportEligibility");
const correctionAllowlist_1 = require("./correctionAllowlist");
/** Map correctable field → parser "missing <field>" warning token. */
const MISSING_WARNING_BY_FIELD = {
    customerPoOrReference: "missing customerPoOrReference",
    vendorOrderNumber: "missing vendorOrderNumber",
    vendorInvoiceNumber: "missing vendorInvoiceNumber",
};
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
/**
 * Drop `missing <field>` warnings when the current header has a non-empty value.
 * Unrelated warnings are preserved (current unresolved issues, not historical audit).
 */
function reconcileParseWarningsForHeader(parseWarnings, parsedHeader) {
    const warnings = Array.isArray(parseWarnings)
        ? parseWarnings.filter((w) => typeof w === "string" && Boolean(w.trim()))
        : [];
    return warnings.filter((warning) => {
        const normalized = warning.trim().toLowerCase();
        for (const field of correctionAllowlist_1.INVOICE_CORRECTABLE_FIELD_KEYS) {
            const missingToken = MISSING_WARNING_BY_FIELD[field];
            if (normalized === missingToken.toLowerCase()) {
                return !(0, correctionAllowlist_1.headerFieldAsString)(parsedHeader, field);
            }
        }
        return true;
    });
}
function parseActiveFulfillmentOverride(raw) {
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
/** Re-apply active human fulfillment override onto a freshly parsed header. */
function applyFulfillmentOverrideToHeader(parsedHeader, fulfillmentOverride) {
    const override = parseActiveFulfillmentOverride(fulfillmentOverride);
    if (!override)
        return asRecord(parsedHeader);
    return {
        ...asRecord(parsedHeader),
        fulfillmentMethod: override.toMethod,
    };
}
/** Re-apply durable fieldCorrectionLog overrides onto a freshly parsed header. */
function applyFieldCorrectionLogToHeader(parsedHeader, fieldCorrectionLog) {
    const next = { ...asRecord(parsedHeader) };
    if (!Array.isArray(fieldCorrectionLog))
        return next;
    for (const raw of fieldCorrectionLog) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const entry = raw;
        if (!(0, correctionAllowlist_1.isCorrectableFieldKey)(entry.field))
            continue;
        const newValue = typeof entry.newValue === "string" ? entry.newValue.trim() : "";
        if (!newValue)
            continue;
        next[entry.field] = newValue;
    }
    return next;
}
/**
 * Build authoritative post-correction import fields from the corrected header
 * and the rest of the current import document.
 */
function reconcileImportStateAfterCorrection(input) {
    const parsedHeader = asRecord(input.parsedHeader);
    const parseWarnings = reconcileParseWarningsForHeader(input.parseWarnings, parsedHeader);
    const importStatus = typeof input.importStatus === "string" && input.importStatus.trim()
        ? input.importStatus
        : "pending";
    const confidenceScore = typeof input.confidenceScore === "number" && Number.isFinite(input.confidenceScore)
        ? input.confidenceScore
        : 0;
    const parserFormatId = input.parserFormatId === "johnstone" ||
        input.parserFormatId === "first_supply" ||
        input.parserFormatId === "generic" ||
        input.parserFormatId === "unknown"
        ? input.parserFormatId
        : undefined;
    const parsedLines = Array.isArray(input.parsedLines)
        ? input.parsedLines.filter((line) => Boolean(line && typeof line === "object"))
        : undefined;
    const eligibility = (0, computeAutoImportEligibility_1.eligibilityFieldsFromInput)({
        importStatus,
        confidenceScore,
        humanReviewRequired: typeof input.humanReviewRequired === "boolean"
            ? input.humanReviewRequired
            : undefined,
        duplicate: typeof input.duplicate === "boolean" ? input.duplicate : undefined,
        parseWarnings,
        parsedHeader,
        parsedLines,
        parsedLineCount: typeof input.parsedLineCount === "number" ? input.parsedLineCount : undefined,
        pageId: typeof input.pageId === "string" ? input.pageId : undefined,
        parserFormatId,
        orderNotes: Array.isArray(input.orderNotes)
            ? input.orderNotes.filter((n) => typeof n === "string")
            : undefined,
        fieldCorrectionLog: input.fieldCorrectionLog,
    });
    return {
        parsedHeader,
        parseWarnings,
        autoImportEligible: eligibility.autoImportEligible,
        autoImportConfidence: eligibility.autoImportConfidence,
        autoImportReasons: eligibility.autoImportReasons,
        reviewRequiredReasons: eligibility.reviewRequiredReasons,
        importDecisionMode: eligibility.importDecisionMode,
        suggestedAction: eligibility.suggestedAction,
    };
}
//# sourceMappingURL=reconcileAfterFieldCorrection.js.map