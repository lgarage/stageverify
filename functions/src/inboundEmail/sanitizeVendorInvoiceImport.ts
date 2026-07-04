/**
 * Sanitize vendor invoice import docs for dispatcher inspect API.
 */
import type {
  VendorInvoiceImportDoc,
  VendorInvoiceImportParsedLine,
} from "./types";

const MAX_PARSE_WARNINGS = 20;
const MAX_ORDER_NOTES = 10;
const MAX_HEADER_STRING = 512;

function trimHeaderValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length <= MAX_HEADER_STRING) return trimmed;
  return `${trimmed.slice(0, MAX_HEADER_STRING)}…`;
}

export function sanitizeVendorInvoiceImportForClient(
  doc: VendorInvoiceImportDoc,
): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  if (doc.parsedHeader && typeof doc.parsedHeader === "object") {
    for (const [key, value] of Object.entries(doc.parsedHeader)) {
      header[key] = trimHeaderValue(value);
    }
  }

  const parsedLines: VendorInvoiceImportParsedLine[] = (doc.parsedLines ?? []).map(
    (line) => ({
      ...line,
      description:
        line.description.length > 240
          ? `${line.description.slice(0, 240)}…`
          : line.description,
      filteredNotes: (line.filteredNotes ?? []).slice(0, 5),
    }),
  );

  return {
    id: doc.id,
    inboundEmailProcessingId: doc.inboundEmailProcessingId,
    gmailMessageId: doc.gmailMessageId,
    importBatchId: doc.importBatchId,
    pageId: doc.pageId,
    pageIndexInBatch: doc.pageIndexInBatch,
    reviewStatus: doc.reviewStatus,
    importStatus: doc.importStatus,
    confidenceTier: doc.confidenceTier,
    confidenceScore: doc.confidenceScore,
    humanReviewRequired: doc.humanReviewRequired,
    duplicate: doc.duplicate,
    duplicateOfPageId: doc.duplicateOfPageId,
    parsedHeader: header,
    parsedLines,
    parsedLineCount: doc.parsedLineCount ?? parsedLines.length,
    parseWarnings: (doc.parseWarnings ?? []).slice(0, MAX_PARSE_WARNINGS),
    orderNotes: (doc.orderNotes ?? []).slice(0, MAX_ORDER_NOTES),
    outcome: doc.outcome,
    error: doc.error ? String(doc.error).slice(0, 500) : undefined,
    linkedDeliveryOrderId: doc.linkedDeliveryOrderId,
    approvedAt: doc.approvedAt,
    rejectedAt: doc.rejectedAt,
    autoImportEligible: doc.autoImportEligible,
    autoImportConfidence: doc.autoImportConfidence,
    autoImportReasons: (doc.autoImportReasons ?? []).slice(0, 12),
    reviewRequiredReasons: (doc.reviewRequiredReasons ?? []).slice(0, 12),
    importDecisionMode: doc.importDecisionMode,
    suggestedAction: doc.suggestedAction
      ? String(doc.suggestedAction).slice(0, 500)
      : undefined,
    importDecisionLog: (doc.importDecisionLog ?? []).slice(-10),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
