"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createImportBatchId = createImportBatchId;
exports.classifyBatchPageOutcome = classifyBatchPageOutcome;
exports.processInvoiceBatch = processInvoiceBatch;
exports.processInvoiceBatchFromExtracted = processInvoiceBatchFromExtracted;
const pdfTextAdapter_1 = require("./pdfTextAdapter");
const parseJohnstoneInvoice_1 = require("./parseJohnstoneInvoice");
const processInvoicePage_1 = require("./processInvoicePage");
function createImportBatchId(suffix) {
    const date = new Date().toISOString().slice(0, 10);
    const token = Math.random().toString(36).slice(2, 8);
    return suffix ? `batch-${date}-${suffix}` : `batch-${date}-${token}`;
}
/** Map Slice 1 processing result to batch outcome buckets. */
function classifyBatchPageOutcome(result) {
    if (result.importStatus === "issue")
        return "needs_review";
    if (result.duplicate)
        return "failed";
    if (result.reviewStatus === "rejected")
        return "failed";
    if (result.reviewStatus === "auto_processed")
        return "processed";
    return "needs_review";
}
function summarizeResults(results) {
    let processed = 0;
    let needsReview = 0;
    let failed = 0;
    for (const row of results) {
        if (row.outcome === "processed")
            processed += 1;
        else if (row.outcome === "needs_review")
            needsReview += 1;
        else
            failed += 1;
    }
    return { processed, needsReview, failed, total: results.length };
}
function emptyExistingIndex() {
    return { byPageId: new Map(), byFingerprint: new Map() };
}
function processOnePage(page, existing) {
    try {
        const normalized = {
            ...page,
            extractedText: page.extractedText.trim(),
        };
        if (!normalized.extractedText) {
            return {
                pageIndexInBatch: page.pageIndexInBatch,
                pageId: page.pageId,
                outcome: "failed",
                processing: null,
                error: "Empty extracted text",
            };
        }
        const processing = (0, processInvoicePage_1.processInvoicePage)(normalized, existing);
        if (!processing.duplicate) {
            existing.byPageId.set(page.pageId, page.pageId);
            existing.byFingerprint.set((0, parseJohnstoneInvoice_1.pageTextFingerprint)(normalized), page.pageId);
        }
        return {
            pageIndexInBatch: page.pageIndexInBatch,
            pageId: page.pageId,
            outcome: classifyBatchPageOutcome(processing),
            processing,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            pageIndexInBatch: page.pageIndexInBatch,
            pageId: page.pageId,
            outcome: "failed",
            processing: null,
            error: message,
        };
    }
}
function sortPagesInBatch(pages) {
    return [...pages].sort((a, b) => a.pageIndexInBatch - b.pageIndexInBatch);
}
/**
 * Process one upload batch — one `importBatchId`, one vendor order per invoice page (spec §11).
 * Page-level failures do not discard successful pages.
 */
function processInvoiceBatch(pages, options) {
    const importBatchId = options?.importBatchId ?? createImportBatchId();
    const existing = options?.existing ?? emptyExistingIndex();
    const ordered = sortPagesInBatch(pages.map((p) => ({ ...p, importBatchId })));
    const results = [];
    for (const page of ordered) {
        results.push(processOnePage(page, existing));
    }
    return { importBatchId, results, summary: summarizeResults(results) };
}
/** End-to-end: PDF extraction adapter → Slice 1 parser for each page in batch. */
function processInvoiceBatchFromExtracted(input, existing) {
    const importBatchId = input.importBatchId ?? createImportBatchId();
    const pages = (0, pdfTextAdapter_1.adaptExtractedPagesToInvoicePages)({ ...input, importBatchId });
    return processInvoiceBatch(pages, { importBatchId, existing });
}
//# sourceMappingURL=processInvoiceBatch.js.map