"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAutoImportEligibility = computeAutoImportEligibility;
exports.eligibilityFieldsFromInput = eligibilityFieldsFromInput;
exports.buildImportDecisionLogEntry = buildImportDecisionLogEntry;
/**
 * Stage 1 — deterministic auto-import eligibility (suggested action only; no CF auto-approve).
 * Shared rules with client copy in src/dispatcher/invoice/computeAutoImportEligibility.ts
 */
const types_1 = require("./types");
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
    const requiredChecks = [
        ["Customer account #", "customerAccountNumber"],
        ["S/O #", "vendorOrderNumber"],
        ["Invoice #", "vendorInvoiceNumber"],
        ["Customer P/O", "customerPoOrReference"],
        ["Order date", "orderDate"],
        ["Johnstone branch", "vendorBranchName"],
    ];
    for (const [label, key] of requiredChecks) {
        const value = headerStr(header, key);
        if (!value) {
            reviewRequiredReasons.push(`Missing ${label}`);
        }
        else {
            autoImportReasons.push(`${label} present`);
            if (key === "vendorBranchName" && !/johnstone/i.test(value)) {
                reviewRequiredReasons.push("Vendor branch not recognized as Johnstone");
            }
        }
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
    if (confidence < types_1.INVOICE_AUTO_APPLY_CONFIDENCE) {
        reviewRequiredReasons.push(`Parser confidence ${confidence} below threshold ${types_1.INVOICE_AUTO_APPLY_CONFIDENCE}`);
    }
    else {
        autoImportReasons.push(`Parser confidence ${confidence} meets threshold (${types_1.INVOICE_AUTO_APPLY_CONFIDENCE}+)`);
    }
    if (input.humanReviewRequired) {
        reviewRequiredReasons.push("Parser flagged human review required");
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
//# sourceMappingURL=computeAutoImportEligibility.js.map