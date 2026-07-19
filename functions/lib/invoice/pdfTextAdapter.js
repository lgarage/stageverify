"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVOICE_PAGE_BOUNDARY = void 0;
exports.normalizeExtractedPageText = normalizeExtractedPageText;
exports.splitExtractedTextIntoPages = splitExtractedTextIntoPages;
exports.joinPagesWithBoundaries = joinPagesWithBoundaries;
exports.mergeMultiPageInvoiceText = mergeMultiPageInvoiceText;
exports.adaptExtractedPagesToInvoicePages = adaptExtractedPagesToInvoicePages;
exports.adaptConcatenatedPdfText = adaptConcatenatedPdfText;
exports.adaptMultiPageDocuments = adaptMultiPageDocuments;
exports.extractedPagesFromTexts = extractedPagesFromTexts;
const invoiceDocumentSplit_1 = require("./invoiceDocumentSplit");
/** Marker inserted between PDF pages when concatenating multi-page extraction output. */
exports.INVOICE_PAGE_BOUNDARY = "\n---INVOICE PAGE---\n";
/** Normalize whitespace from PDF text extractors (pdf-parse, OCR, fixtures). */
function normalizeExtractedPageText(text) {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\f/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
/** Split a single concatenated extraction blob into per-page strings. */
function splitExtractedTextIntoPages(text) {
    const normalized = text.replace(/\r\n/g, "\n");
    if (normalized.includes(exports.INVOICE_PAGE_BOUNDARY)) {
        return normalized
            .split(exports.INVOICE_PAGE_BOUNDARY)
            .map(normalizeExtractedPageText)
            .filter(Boolean);
    }
    if (normalized.includes("\f")) {
        return normalized
            .split("\f")
            .map(normalizeExtractedPageText)
            .filter(Boolean);
    }
    const trimmed = normalizeExtractedPageText(normalized);
    return trimmed ? [trimmed] : [];
}
/** Join per-page texts with the standard boundary marker (multi-page replay / debugging). */
function joinPagesWithBoundaries(pages) {
    return pages.map(normalizeExtractedPageText).filter(Boolean).join(exports.INVOICE_PAGE_BOUNDARY);
}
/** Merge multiple physical PDF pages into one invoice text block for the Slice 1 parser. */
function mergeMultiPageInvoiceText(extractedPages) {
    return extractedPages.map(normalizeExtractedPageText).filter(Boolean).join("\n\n");
}
function resolvePageId(pageIds, pageIndex) {
    return pageIds?.[pageIndex] ?? `page-${pageIndex}`;
}
/**
 * Adapt PDF extraction output to Slice 1 page records.
 * One `JohnstoneInvoicePageText` per logical invoice page (spec §11).
 */
function adaptExtractedPagesToInvoicePages(input) {
    const importBatchId = input.importBatchId ?? `batch-${new Date().toISOString().slice(0, 10)}-extract`;
    return input.pages.map((page) => {
        const text = normalizeExtractedPageText(page.extractedText);
        if (!text) {
            throw new Error(`Empty extracted text at page index ${page.pageIndex}`);
        }
        return {
            pageId: resolvePageId(input.pageIds, page.pageIndex),
            importBatchId,
            pageIndexInBatch: page.pageIndex,
            extractedText: text,
        };
    });
}
/** Build invoice pages from a concatenated multi-page PDF extraction string. */
function adaptConcatenatedPdfText(concatenatedText, importBatchId, pageIds, options) {
    const pageTexts = (0, invoiceDocumentSplit_1.splitExtractedTextIntoInvoiceDocuments)(concatenatedText, options?.routeHints);
    const batchId = importBatchId ?? `batch-${new Date().toISOString().slice(0, 10)}-concat`;
    return adaptExtractedPagesToInvoicePages({
        importBatchId: batchId,
        pages: pageTexts.map((extractedText, pageIndex) => ({ pageIndex, extractedText })),
        pageIds,
    });
}
/** Adapt multi-page documents where one invoice spans several physical PDF pages. */
function adaptMultiPageDocuments(documents, importBatchId) {
    const batchId = importBatchId ?? `batch-${new Date().toISOString().slice(0, 10)}-multi`;
    return documents.map((doc, pageIndex) => {
        const extractedText = mergeMultiPageInvoiceText(doc.extractedPages);
        if (!extractedText) {
            throw new Error(`Empty multi-page document at index ${pageIndex}`);
        }
        return {
            pageId: doc.pageId ?? `page-${pageIndex}`,
            importBatchId: batchId,
            pageIndexInBatch: pageIndex,
            extractedText,
        };
    });
}
/** Convenience: map plain string array (fixture replay) to extracted page shape. */
function extractedPagesFromTexts(pageTexts) {
    return pageTexts.map((extractedText, pageIndex) => ({
        pageIndex,
        extractedText: normalizeExtractedPageText(extractedText),
    }));
}
//# sourceMappingURL=pdfTextAdapter.js.map