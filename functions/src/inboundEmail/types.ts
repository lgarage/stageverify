/** Inbound Gmail invoice ingestion — Firestore document shapes (Admin SDK / CF only). */

export type InboundEmailProcessingStatus =
  | "pending"
  | "processing"
  | "extracted"
  | "parsed"
  | "no_pdf"
  | "error";

export type InboundEmailReviewStatus = "pending_review";

export interface InboundPdfAttachmentRecord {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  gmailAttachmentId: string;
  extractedText?: string;
  extractError?: string;
  pageCount?: number;
}

export interface InboundEmailParseSummary {
  importBatchId: string;
  processed: number;
  needsReview: number;
  failed: number;
  total: number;
  reviewRecordIds: string[];
}

export interface InboundEmailProcessingDoc {
  id: string;
  gmailMessageId: string;
  threadId?: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  attachmentFilenames: string[];
  pdfAttachments: InboundPdfAttachmentRecord[];
  /** Concatenated text from all PDF attachments (for inspection). */
  combinedExtractedText?: string;
  processingStatus: InboundEmailProcessingStatus;
  processingError?: string;
  parseResult?: InboundEmailParseSummary;
  /** Invoice imports from email are always pending_review until human approval. */
  reviewStatus: InboundEmailReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export type VendorInvoiceImportReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected";

/** Persisted line row — spec Table B (sanitized subset of ParsedInvoiceLine). */
export interface VendorInvoiceImportParsedLine {
  lineNumber: number;
  quantityOrdered: number;
  quantityShipped: number;
  quantityBackordered: number;
  vendorProductNumber: string;
  manufacturerOrModelNumber?: string;
  description: string;
  filteredNotes: string[];
  lineType: string;
  excludeFromExpectedItems: boolean;
}

/** Review queue record — parse output only; never auto-applies to deliveries. */
export interface VendorInvoiceImportDoc {
  id: string;
  inboundEmailProcessingId: string;
  gmailMessageId: string;
  importBatchId: string;
  pageId: string;
  pageIndexInBatch: number;
  reviewStatus: VendorInvoiceImportReviewStatus;
  importStatus: string;
  confidenceTier: string;
  confidenceScore: number;
  humanReviewRequired: boolean;
  duplicate: boolean;
  duplicateOfPageId?: string;
  parsedHeader: Record<string, unknown>;
  /** Sanitized parsed.lines[] per spec Table B. */
  parsedLines: VendorInvoiceImportParsedLine[];
  parsedLineCount: number;
  parseWarnings: string[];
  orderNotes: string[];
  outcome: "needs_review" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Gmail API message shapes (subset for fixtures + live fetch). */
export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessagePayload {
  headers?: GmailMessageHeader[];
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePayload;
}
