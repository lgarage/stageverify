"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitExtractedTextIntoInvoiceDocuments = splitExtractedTextIntoInvoiceDocuments;
exports.preferredPreParseFormat = preferredPreParseFormat;
const pdfTextAdapter_1 = require("./pdfTextAdapter");
const vendorInvoiceRouter_1 = require("./vendorInvoiceRouter");
function splitFirstSupplyInvoiceBlocks(text) {
    const parts = text
        .split(/\n(?=Invoice\n)/)
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.map((part) => (part.startsWith("Invoice") ? part : `Invoice\n${part}`));
}
/** Split extracted PDF text into one string per logical vendor invoice document. */
function splitExtractedTextIntoInvoiceDocuments(text, hints) {
    const normalized = text.replace(/\r\n/g, "\n");
    const route = (0, vendorInvoiceRouter_1.routeInvoiceFormat)(normalized, hints);
    if (route.formatId === "first_supply" || /First Supply LLC/i.test(normalized)) {
        const blocks = splitFirstSupplyInvoiceBlocks(normalized);
        if (blocks.length > 0)
            return blocks;
    }
    if (normalized.includes(pdfTextAdapter_1.INVOICE_PAGE_BOUNDARY)) {
        return normalized
            .split(pdfTextAdapter_1.INVOICE_PAGE_BOUNDARY)
            .map(pdfTextAdapter_1.normalizeExtractedPageText)
            .filter(Boolean);
    }
    if (normalized.includes("\f")) {
        return normalized
            .split("\f")
            .map(pdfTextAdapter_1.normalizeExtractedPageText)
            .filter(Boolean);
    }
    const trimmed = (0, pdfTextAdapter_1.normalizeExtractedPageText)(normalized);
    return trimmed ? [trimmed] : [];
}
function preferredPreParseFormat(text, hints) {
    return (0, vendorInvoiceRouter_1.routeInvoiceFormat)(text, hints).formatId;
}
//# sourceMappingURL=invoiceDocumentSplit.js.map