"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forceReviewOnlyStatus = forceReviewOnlyStatus;
exports.parseInboundInvoiceText = parseInboundInvoiceText;
/**
 * Vendor invoice parse for inbound email — review-only path.
 * Hard rule: always pending_review; never auto_processed; no delivery writes.
 */
const pdfTextAdapter_1 = require("./pdfTextAdapter");
const processInvoiceBatch_1 = require("./processInvoiceBatch");
function forceReviewOnlyStatus(result) {
    return {
        ...result,
        humanReviewRequired: true,
        reviewStatus: "pending_review",
    };
}
/** Parse extracted PDF text from inbound email into review-only batch results. */
function parseInboundInvoiceText(combinedText, options) {
    const processOptions = {
        routeHints: { senderEmail: options.senderEmail },
    };
    const pages = (0, pdfTextAdapter_1.adaptConcatenatedPdfText)(combinedText, options.importBatchId, undefined, processOptions);
    const batch = (0, processInvoiceBatch_1.processInvoiceBatch)(pages, {
        importBatchId: options.importBatchId,
        processOptions,
    });
    return {
        ...batch,
        results: batch.results.map((row) => {
            if (!row.processing)
                return row;
            const reviewOnly = forceReviewOnlyStatus(row.processing);
            return {
                ...row,
                processing: reviewOnly,
                outcome: row.outcome === "failed" ? "failed" : "needs_review",
            };
        }),
        summary: {
            ...batch.summary,
            processed: 0,
            needsReview: batch.results.filter((r) => r.outcome !== "failed").length,
        },
    };
}
//# sourceMappingURL=processInvoiceForInbound.js.map