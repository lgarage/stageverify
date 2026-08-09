"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAutoImportEligibility = computeAutoImportEligibility;
exports.eligibilityFieldsFromInput = eligibilityFieldsFromInput;
exports.buildImportDecisionLogEntry = buildImportDecisionLogEntry;
exports.resolveAutoImportEligibility = resolveAutoImportEligibility;
/**
 * Stage 1 — deterministic auto-import eligibility (suggested action only; no CF auto-approve).
 * Client mirror: src/dispatcher/invoice/computeAutoImportEligibility.ts
 */
const types_1 = require("./types");
const creditReturnSkip_1 = require("./creditReturnSkip");
function headerStr(header, key) {
    const v = header[key];
    return typeof v === "string" ? v.trim() : "";
}
function inferDocumentType(input) {
    const header = input.parsedHeader ?? {};
    const invoiceNum = headerStr(header, "vendorInvoiceNumber");
    const orderNum = headerStr(header, "vendorOrderNumber");
    const warnings = (input.parseWarnings ?? []).map((w) => w.toLowerCase());
    const missingInvoiceWarning = warnings.some((w) => w.includes("missing vendorinvoicenumber"));
    if (invoiceNum)
        return "invoice";
    if (orderNum && (missingInvoiceWarning || input.importStatus === "issue")) {
        return "sales_order_confirmation";
    }
    const pageId = input.pageId ?? "";
    if (/^inv-so-/i.test(pageId) || /\bso[-#]/i.test(pageId)) {
        return "sales_order_confirmation";
    }
    if (orderNum && !invoiceNum)
        return "sales_order_confirmation";
    if (orderNum)
        return "invoice";
    return "unknown";
}
function productLines(input) {
    const lines = input.parsedLines ?? [];
    return lines.filter((l) => l.lineType === "product" && !l.excludeFromExpectedItems);
}
/** Local allowlist mirror — do not import reviewChat/correctionAllowlist here. */
const STALE_VETO_CORRECTABLE_FIELD_KEYS = [
    "customerPoOrReference",
    "vendorOrderNumber",
    "vendorInvoiceNumber",
];
/** True when a confirmed allowlisted correction matches the CURRENT header value. */
function hasVerifiedCorrectionForCurrentHeader(fieldCorrectionLog, header) {
    if (!Array.isArray(fieldCorrectionLog))
        return false;
    return fieldCorrectionLog.some((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return false;
        const entry = raw;
        const field = entry.field;
        if (typeof field !== "string" ||
            !STALE_VETO_CORRECTABLE_FIELD_KEYS.includes(field)) {
            return false;
        }
        const newValue = typeof entry.newValue === "string" ? entry.newValue.trim() : "";
        if (!newValue)
            return false;
        return headerStr(header, field) === newValue;
    });
}
/** Deterministic eligibility — explains suggested vs review vs blocked. */
function computeAutoImportEligibility(input) {
    const autoImportReasons = [];
    const reviewRequiredReasons = [];
    const header = input.parsedHeader ?? {};
    const confidence = Math.max(0, Math.min(100, input.confidenceScore ?? 0));
    const docType = inferDocumentType(input);
    const lines = productLines(input);
    const lineCount = input.parsedLineCount ?? lines.length;
    if (input.duplicate) {
        reviewRequiredReasons.push("Duplicate of another import page");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    if ((0, creditReturnSkip_1.isCreditReturnImportDoc)({
        parsedHeader: input.parsedHeader,
        parsedLines: input.parsedLines,
        orderNotes: input.orderNotes,
    })) {
        reviewRequiredReasons.push("Credit/return memo — not valid for delivery import");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    if (input.importStatus === "issue") {
        reviewRequiredReasons.push("Import status is Issue — parse or required-field problems");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    if (docType === "sales_order_confirmation") {
        reviewRequiredReasons.push("Document is S/O confirmation without Invoice # — wait for billable invoice");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    if (docType === "unknown") {
        reviewRequiredReasons.push("Unknown document type — cannot classify as invoice");
    }
    if (lineCount === 0 || lines.length === 0) {
        reviewRequiredReasons.push("No product lines parsed");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    autoImportReasons.push(`${lines.length} product line(s) parsed`);
    const parserFormatId = input.parserFormatId ?? "johnstone";
    if (parserFormatId === "unknown") {
        reviewRequiredReasons.push("Unrecognized vendor invoice format");
        return finalize(false, confidence, autoImportReasons, reviewRequiredReasons, "blocked");
    }
    const requiredChecks = parserFormatId === "first_supply"
        ? [
            ["Customer account #", "customerAccountNumber", true],
            ["Invoice #", "vendorInvoiceNumber", true],
            ["Customer P/O", "customerPoOrReference", true],
            ["Order date", "orderDate", true],
            ["First Supply branch", "vendorBranchName", true],
        ]
        : parserFormatId === "generic"
            ? [
                ["Invoice #", "vendorInvoiceNumber", true],
                ["Customer P/O or reference", "customerPoOrReference", false],
                ["Vendor name", "vendorBranchName", false],
            ]
            : [
                ["Customer account #", "customerAccountNumber", true],
                ["S/O #", "vendorOrderNumber", true],
                ["Invoice #", "vendorInvoiceNumber", true],
                ["Customer P/O", "customerPoOrReference", true],
                ["Order date", "orderDate", true],
                ["Johnstone branch", "vendorBranchName", true],
            ];
    for (const [label, key, required] of requiredChecks) {
        const value = headerStr(header, key);
        if (!value) {
            if (required)
                reviewRequiredReasons.push(`Missing ${label}`);
        }
        else {
            autoImportReasons.push(`${label} present`);
            if (key === "vendorBranchName" && parserFormatId === "johnstone" && !/johnstone/i.test(value)) {
                reviewRequiredReasons.push("Vendor branch not recognized as Johnstone");
            }
            if (key === "vendorBranchName" && parserFormatId === "first_supply" && !/first supply/i.test(value)) {
                reviewRequiredReasons.push("Vendor branch not recognized as First Supply");
            }
            if (key === "vendorBranchName" &&
                parserFormatId === "generic" &&
                /johnstone|first supply/i.test(value)) {
                autoImportReasons.push("Known vendor name detected — optional format helper may apply on reparse");
            }
        }
    }
    if (parserFormatId === "generic") {
        reviewRequiredReasons.push("Generic vendor-agnostic parse — dispatcher review required");
    }
    const hasParty = headerStr(header, "buyerName") ||
        headerStr(header, "shipToName") ||
        headerStr(header, "soldToName");
    if (!hasParty) {
        reviewRequiredReasons.push("Missing buyer or ship-to party");
    }
    else {
        autoImportReasons.push("Buyer or ship-to present");
    }
    if (input.importStatus === "partial") {
        reviewRequiredReasons.push("Partial fulfillment — backorder or incomplete quantities");
    }
    else if (input.importStatus === "pending" || input.importStatus === "pickup_at_vendor") {
        autoImportReasons.push(`Safe import status (${input.importStatus})`);
    }
    else {
        reviewRequiredReasons.push(`Import status "${input.importStatus}" needs dispatcher review`);
    }
    const hasBackorder = lines.some((l) => (l.quantityBackordered ?? 0) > 0);
    const hasPartialShip = lines.some((l) => (l.quantityShipped ?? 0) < (l.quantityOrdered ?? 0) &&
        (l.quantityBackordered ?? 0) === 0);
    const noFulfilledMaterial = lines.every((l) => (l.quantityShipped ?? 0) === 0);
    if (hasBackorder)
        reviewRequiredReasons.push("Backordered lines present");
    if (hasPartialShip)
        reviewRequiredReasons.push("Partial ship quantities on one or more lines");
    if (noFulfilledMaterial)
        reviewRequiredReasons.push("No fulfilled/shipped quantity on lines");
    if (!hasBackorder && !hasPartialShip && !noFulfilledMaterial) {
        autoImportReasons.push("Clean shipped quantities on all lines");
    }
    const warnings = (input.parseWarnings ?? []).filter(Boolean);
    const criticalWarnings = warnings.filter((w) => /missing vendorinvoicenumber|extract failed|garbled/i.test(w));
    if (criticalWarnings.length > 0) {
        reviewRequiredReasons.push(`Critical parse warnings: ${criticalWarnings.join("; ")}`);
    }
    else if (warnings.length > 0) {
        reviewRequiredReasons.push(`Parse warnings (${warnings.length})`);
    }
    else {
        autoImportReasons.push("No parse warnings");
    }
    // CLEANUP / SPLIT-lite Phase 1: keep confidenceScore as parse-time diagnostic.
    // When verified C2 corrections cover CURRENT header fields and no other
    // operational blockers remain, do not let stale confidence/HRR independently veto.
    const otherBlockersExist = reviewRequiredReasons.length > 0;
    const canSkipStaleParserEraVetoes = !otherBlockersExist &&
        hasVerifiedCorrectionForCurrentHeader(input.fieldCorrectionLog, header);
    if (confidence < types_1.INVOICE_AUTO_APPLY_CONFIDENCE) {
        if (canSkipStaleParserEraVetoes) {
            autoImportReasons.push(`Parser confidence ${confidence} below threshold ${types_1.INVOICE_AUTO_APPLY_CONFIDENCE} — not vetoed (verified correction confirmed for this import)`);
        }
        else {
            reviewRequiredReasons.push(`Parser confidence ${confidence} below threshold ${types_1.INVOICE_AUTO_APPLY_CONFIDENCE}`);
        }
    }
    else {
        autoImportReasons.push(`Parser confidence ${confidence} meets threshold (${types_1.INVOICE_AUTO_APPLY_CONFIDENCE}+)`);
    }
    if (input.humanReviewRequired) {
        if (canSkipStaleParserEraVetoes) {
            autoImportReasons.push("Parser flagged human review required — not vetoed (verified correction confirmed for this import)");
        }
        else {
            reviewRequiredReasons.push("Parser flagged human review required");
        }
    }
    const autoImportEligible = reviewRequiredReasons.length === 0;
    const importDecisionMode = autoImportEligible
        ? "suggested_import"
        : reviewRequiredReasons.some((r) => r.startsWith("Duplicate") ||
            r.startsWith("Import status is Issue") ||
            r.startsWith("Document is S/O") ||
            r.startsWith("No product lines"))
            ? "blocked"
            : "review_required";
    return finalize(autoImportEligible, confidence, autoImportReasons, reviewRequiredReasons, importDecisionMode);
}
function finalize(autoImportEligible, autoImportConfidence, autoImportReasons, reviewRequiredReasons, importDecisionMode) {
    let suggestedAction;
    if (importDecisionMode === "suggested_import") {
        suggestedAction =
            "Suggested: Approve to create dashboard record — high confidence; dispatcher confirms (no automatic import).";
    }
    else if (importDecisionMode === "blocked") {
        suggestedAction = "Blocked — resolve listed issues before approve.";
    }
    else {
        suggestedAction = "Review required — inspect fields and match before approve.";
    }
    return {
        autoImportEligible,
        autoImportConfidence,
        autoImportReasons,
        reviewRequiredReasons,
        importDecisionMode,
        suggestedAction,
    };
}
function eligibilityFieldsFromInput(input) {
    return computeAutoImportEligibility(input);
}
function buildImportDecisionLogEntry(action, uid, at, eligibility, deliveryOrderId) {
    return {
        action,
        at,
        by: uid,
        importDecisionMode: eligibility.importDecisionMode,
        autoImportEligible: eligibility.autoImportEligible,
        autoImportReasons: eligibility.autoImportReasons.slice(0, 12),
        reviewRequiredReasons: eligibility.reviewRequiredReasons.slice(0, 12),
        ...(deliveryOrderId ? { deliveryOrderId } : {}),
    };
}
/** True when persisted “Missing …” reasons contradict the current corrected header. */
function persistedEligibilityStaleAfterCorrection(row) {
    const reasons = row.reviewRequiredReasons ?? [];
    if (reasons.length === 0)
        return false;
    const header = row.parsedHeader ?? {};
    const checks = [
        [/missing customer p\/?o/i, "customerPoOrReference"],
        [/missing s\/?o|missing vendor order/i, "vendorOrderNumber"],
        [/missing invoice/i, "vendorInvoiceNumber"],
    ];
    for (const [re, key] of checks) {
        if (!reasons.some((r) => re.test(r)))
            continue;
        const value = header[key];
        if (typeof value === "string" && value.trim())
            return true;
    }
    if (reasons.some((r) => /^Parse warnings\b/i.test(r)) &&
        Array.isArray(row.parseWarnings)) {
        const unresolved = row.parseWarnings.filter(Boolean);
        const match = reasons.find((r) => /^Parse warnings\s*\((\d+)\)/i.test(r));
        const m = match?.match(/\((\d+)\)/);
        if (m && Number(m[1]) !== unresolved.length)
            return true;
    }
    if (reasons.some((r) => /^Parser confidence .* below threshold|^Parser flagged human review required/i.test(r)) &&
        hasVerifiedCorrectionForCurrentHeader(row.fieldCorrectionLog, header)) {
        return true;
    }
    return false;
}
/** Use persisted fields when present; recompute for legacy rows / post-correction stale state. */
function resolveAutoImportEligibility(row) {
    if (row.importDecisionMode &&
        row.autoImportEligible !== undefined &&
        row.suggestedAction &&
        !persistedEligibilityStaleAfterCorrection(row)) {
        return {
            autoImportEligible: row.autoImportEligible,
            autoImportConfidence: row.autoImportConfidence ?? row.confidenceScore,
            autoImportReasons: row.autoImportReasons ?? [],
            reviewRequiredReasons: row.reviewRequiredReasons ?? [],
            importDecisionMode: row.importDecisionMode,
            suggestedAction: row.suggestedAction,
        };
    }
    return computeAutoImportEligibility(row);
}
//# sourceMappingURL=computeAutoImportEligibility.js.map