import { adaptExtractedPagesToInvoicePages } from "./pdfTextAdapter";
import { pageTextFingerprint as johnstoneFingerprint } from "./parseJohnstoneInvoice";
import { pageTextFingerprint as firstSupplyFingerprint } from "./parseFirstSupplyInvoice";
import {
  type ExistingInvoiceIndex,
  processInvoicePage,
} from "./processInvoicePage";
import type {
  InvoiceBatchPageOutcome,
  InvoiceBatchPageResult,
  InvoiceBatchResult,
  InvoiceBatchSummary,
  InvoicePdfExtractInput,
  InvoiceProcessOptions,
  InvoiceProcessingResult,
  JohnstoneInvoicePageText,
} from "./types";

export function createImportBatchId(suffix?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const token = Math.random().toString(36).slice(2, 8);
  return suffix ? `batch-${date}-${suffix}` : `batch-${date}-${token}`;
}

/** Map Slice 1 processing result to batch outcome buckets. */
export function classifyBatchPageOutcome(
  result: InvoiceProcessingResult,
): InvoiceBatchPageOutcome {
  if (result.importStatus === "issue") return "needs_review";
  if (result.duplicate) return "failed";
  if (result.reviewStatus === "rejected") return "failed";
  if (result.reviewStatus === "auto_processed") return "processed";
  return "needs_review";
}

function summarizeResults(results: InvoiceBatchPageResult[]): InvoiceBatchSummary {
  let processed = 0;
  let needsReview = 0;
  let failed = 0;
  for (const row of results) {
    if (row.outcome === "processed") processed += 1;
    else if (row.outcome === "needs_review") needsReview += 1;
    else failed += 1;
  }
  return { processed, needsReview, failed, total: results.length };
}

function emptyExistingIndex(): ExistingInvoiceIndex {
  return { byPageId: new Map(), byFingerprint: new Map() };
}

function processOnePage(
  page: JohnstoneInvoicePageText,
  existing: ExistingInvoiceIndex,
  processOptions?: InvoiceProcessOptions,
): InvoiceBatchPageResult {
  try {
    const normalized: JohnstoneInvoicePageText = {
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

    const processing = processInvoicePage(normalized, existing, processOptions);

    if (!processing.duplicate) {
      existing.byPageId.set(page.pageId, page.pageId);
      const fingerprint =
        processing.parserFormatId === "first_supply"
          ? firstSupplyFingerprint(normalized)
          : johnstoneFingerprint(normalized);
      existing.byFingerprint.set(fingerprint, page.pageId);
    }

    return {
      pageIndexInBatch: page.pageIndexInBatch,
      pageId: page.pageId,
      outcome: classifyBatchPageOutcome(processing),
      processing,
    };
  } catch (err) {
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

function sortPagesInBatch(pages: JohnstoneInvoicePageText[]): JohnstoneInvoicePageText[] {
  return [...pages].sort((a, b) => a.pageIndexInBatch - b.pageIndexInBatch);
}

/**
 * Process one upload batch — one `importBatchId`, one vendor order per invoice page (spec §11).
 * Page-level failures do not discard successful pages.
 */
export function processInvoiceBatch(
  pages: JohnstoneInvoicePageText[],
  options?: {
    importBatchId?: string;
    existing?: ExistingInvoiceIndex;
    processOptions?: InvoiceProcessOptions;
  },
): InvoiceBatchResult {
  const importBatchId = options?.importBatchId ?? createImportBatchId();
  const existing = options?.existing ?? emptyExistingIndex();
  const ordered = sortPagesInBatch(
    pages.map((p) => ({ ...p, importBatchId })),
  );

  const results: InvoiceBatchPageResult[] = [];
  for (const page of ordered) {
    results.push(processOnePage(page, existing, options?.processOptions));
  }

  return { importBatchId, results, summary: summarizeResults(results) };
}

/** End-to-end: PDF extraction adapter → Slice 1 parser for each page in batch. */
export function processInvoiceBatchFromExtracted(
  input: InvoicePdfExtractInput,
  existing?: ExistingInvoiceIndex,
): InvoiceBatchResult {
  const importBatchId = input.importBatchId ?? createImportBatchId();
  const pages = adaptExtractedPagesToInvoicePages({ ...input, importBatchId });
  return processInvoiceBatch(pages, { importBatchId, existing });
}
