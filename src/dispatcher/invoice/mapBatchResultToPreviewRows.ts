import type { VendorInvoiceImportParsedLine, VendorInvoiceImportReview } from "../models";
import { vendorInvoiceImportDisplayLabelForRow } from "./invoiceDisplayHelpers";
import type {
  InvoiceBatchPageOutcome,
  InvoiceBatchPageResult,
  InvoiceBatchResult,
  InvoiceFulfillmentMethod,
  InvoiceProcessingResult,
  ParsedInvoiceLine,
} from "./types";

/** Dispatcher-facing row for offline batch preview table (Slice 3). */
export interface InvoiceOfflinePreviewRow {
  pageId: string;
  pageIndexInBatch: number;
  outcome: InvoiceBatchPageOutcome;
  outcomeLabel: string;
  vendorInvoiceNumber: string;
  customerPoOrReference: string;
  fulfillmentLabel: string;
  importStatusLabel: string;
  confidenceScore: number | null;
  confidenceTier: string | null;
  errorMessage: string | null;
  processing: InvoiceProcessingResult | null;
}

const BATCH_OUTCOME_LABEL: Record<InvoiceBatchPageOutcome, string> = {
  processed: "Processed",
  needs_review: "Needs review",
  failed: "Failed",
};

const FULFILLMENT_LABEL: Record<InvoiceFulfillmentMethod, string> = {
  delivery: "Delivery",
  will_call_pickup: "Will-call pickup",
  unknown: "Unknown",
};

export function batchOutcomeLabel(outcome: InvoiceBatchPageOutcome): string {
  return BATCH_OUTCOME_LABEL[outcome];
}

export function fulfillmentMethodLabel(method: InvoiceFulfillmentMethod): string {
  return FULFILLMENT_LABEL[method];
}

function mapParsedLines(lines: ParsedInvoiceLine[]): VendorInvoiceImportParsedLine[] {
  return lines.map((line) => ({
    lineNumber: line.lineNumber,
    quantityOrdered: line.quantityOrdered,
    quantityShipped: line.quantityShipped,
    quantityBackordered: line.quantityBackordered,
    vendorProductNumber: line.vendorProductNumber,
    manufacturerOrModelNumber: line.manufacturerOrModelNumber,
    description: line.description,
    unitOfMeasure: line.unitOfMeasure,
    lineExtension: line.lineExtension,
    filteredNotes: line.filteredNotes,
    lineType: line.lineType,
    excludeFromExpectedItems: line.excludeFromExpectedItems,
  }));
}

function reviewStatusFromProcessing(
  processing: InvoiceProcessingResult,
): VendorInvoiceImportReview["reviewStatus"] {
  if (processing.reviewStatus === "rejected") return "rejected";
  if (processing.reviewStatus === "approved") return "approved";
  return "pending_review";
}

export function mapBatchPageResultToPreviewRow(
  row: InvoiceBatchPageResult,
): InvoiceOfflinePreviewRow {
  const processing = row.processing;
  const header = processing?.parsed.header;
  const importStatus = processing?.importStatus;
  const orderNotes = processing?.parsed.orderNotes;

  return {
    pageId: row.pageId,
    pageIndexInBatch: row.pageIndexInBatch,
    outcome: row.outcome,
    outcomeLabel: batchOutcomeLabel(row.outcome),
    vendorInvoiceNumber: header?.vendorInvoiceNumber?.trim() || "—",
    customerPoOrReference: header?.customerPoOrReference?.trim() || "—",
    fulfillmentLabel: header
      ? fulfillmentMethodLabel(header.fulfillmentMethod)
      : "—",
    importStatusLabel:
      importStatus != null
        ? vendorInvoiceImportDisplayLabelForRow(importStatus, orderNotes)
        : "—",
    confidenceScore: processing?.confidenceScore ?? null,
    confidenceTier: processing?.confidenceTier ?? null,
    errorMessage: row.error?.trim() || null,
    processing,
  };
}

export function mapBatchResultToPreviewRows(
  batch: InvoiceBatchResult,
): InvoiceOfflinePreviewRow[] {
  return batch.results.map(mapBatchPageResultToPreviewRow);
}

/** Synthetic review row for read-only inspect modal — no Firestore id. */
export function buildOfflineImportReviewFromPageResult(
  batch: InvoiceBatchResult,
  row: InvoiceBatchPageResult,
): VendorInvoiceImportReview | null {
  const processing = row.processing;
  if (!processing) return null;

  const now = new Date().toISOString();
  const parsed = processing.parsed;

  return {
    id: `offline-preview-${row.pageId}`,
    inboundEmailProcessingId: "",
    gmailMessageId: "",
    importBatchId: batch.importBatchId,
    pageId: row.pageId,
    reviewStatus: reviewStatusFromProcessing(processing),
    importStatus: processing.importStatus,
    confidenceScore: processing.confidenceScore,
    humanReviewRequired: processing.humanReviewRequired,
    duplicate: processing.duplicate,
    duplicateOfPageId: processing.duplicateOfPageId,
    parsedHeader: { ...parsed.header },
    parsedLines: mapParsedLines(parsed.lines),
    parsedLineCount: parsed.lines.length,
    parseWarnings: [...parsed.parseWarnings],
    orderNotes: [...parsed.orderNotes],
    error: row.error,
    createdAt: now,
    updatedAt: now,
  };
}
