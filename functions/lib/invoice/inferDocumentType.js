"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentTypeLabel = documentTypeLabel;
exports.normalizeParserFormatId = normalizeParserFormatId;
exports.inferDocumentType = inferDocumentType;
/**
 * Infer document type from stored parse output (CF ingest + ignore fingerprints).
 * Mirrors src/dispatcher/invoice/inferDocumentType.ts — keep in sync.
 */
const creditReturnSkip_1 = require("./creditReturnSkip");
const DOC_TYPE_LABELS = {
    sales_order_confirmation: "Sales order confirmation (S/O)",
    invoice: "Invoice",
    credit_memo: "Credit memo (CREDIT)",
    unknown: "Unknown document type",
};
function documentTypeLabel(docType) {
    return DOC_TYPE_LABELS[docType] ?? DOC_TYPE_LABELS.unknown;
}
function asNonEmptyString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function headerField(header, key) {
    if (!header)
        return "";
    return asNonEmptyString(header[key]);
}
function normalizeParserFormatId(raw) {
    if (raw === "johnstone" || raw === "first_supply" || raw === "generic") {
        return raw;
    }
    return "unknown";
}
function inferDocumentType(importRow) {
    if (importRow.skipReason === "credit_return" ||
        (0, creditReturnSkip_1.isCreditReturnImportDoc)({
            parsedHeader: importRow.parsedHeader,
            parsedLines: importRow.parsedLines,
            orderNotes: importRow.orderNotes,
        })) {
        return "credit_memo";
    }
    const invoiceNum = headerField(importRow.parsedHeader, "vendorInvoiceNumber");
    const orderNum = headerField(importRow.parsedHeader, "vendorOrderNumber");
    const warnings = (importRow.parseWarnings ?? []).map((w) => w.toLowerCase());
    const missingInvoiceWarning = warnings.some((w) => w.includes("missing vendorinvoicenumber"));
    const pageId = asNonEmptyString(importRow.pageId);
    if (invoiceNum)
        return "invoice";
    if (orderNum &&
        (missingInvoiceWarning || importRow.importStatus === "issue")) {
        return "sales_order_confirmation";
    }
    if (/^inv-so-/i.test(pageId) || /\bso[-#]/i.test(pageId)) {
        return "sales_order_confirmation";
    }
    if (orderNum && !invoiceNum) {
        return "sales_order_confirmation";
    }
    if (orderNum)
        return "invoice";
    return "unknown";
}
//# sourceMappingURL=inferDocumentType.js.map