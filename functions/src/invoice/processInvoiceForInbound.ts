/**
 * Johnstone invoice parse for inbound email — review-only path.
 * Hard rule: always pending_review; never auto_processed; no delivery writes.
 */
import { adaptConcatenatedPdfText } from "./pdfTextAdapter";
import { processInvoiceBatch } from "./processInvoiceBatch";
import type { InvoiceBatchResult, InvoiceProcessingResult } from "./types";

export function forceReviewOnlyStatus(
  result: InvoiceProcessingResult,
): InvoiceProcessingResult {
  return {
    ...result,
    humanReviewRequired: true,
    reviewStatus: "pending_review",
  };
}

/** Parse extracted PDF text from inbound email into review-only batch results. */
export function parseInboundInvoiceText(
  combinedText: string,
  options: { importBatchId: string; gmailMessageId: string },
): InvoiceBatchResult {
  const pages = adaptConcatenatedPdfText(
    combinedText,
    options.importBatchId,
    undefined,
  );
  const batch = processInvoiceBatch(pages, { importBatchId: options.importBatchId });
  return {
    ...batch,
    results: batch.results.map((row) => {
      if (!row.processing) return row;
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
