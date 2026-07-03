/** Import-domain status — distinct from V1 DeliveryStatus until readiness alignment. */
export type VendorInvoiceImportStatus =
  | "pending"
  | "partial"
  | "ready_for_pickup"
  | "pickup_at_vendor"
  | "closed_picked_up"
  | "issue";

export type InvoiceFulfillmentMethod = "delivery" | "will_call_pickup" | "unknown";

export type InvoiceLineType = "product" | "core_charge" | "return" | "freight" | "ignored";

export type InvoiceConfidenceTier = "high" | "medium" | "low";

/** Plain-text page extracted from a Johnstone branch invoice PDF (offline prototype). */
export interface JohnstoneInvoicePageText {
  pageId: string;
  importBatchId: string;
  pageIndexInBatch: number;
  extractedText: string;
}

export interface ParsedInvoiceHeader {
  customerAccountNumber: string;
  vendorOrderNumber: string;
  vendorInvoiceNumber: string;
  customerPoOrReference: string;
  quoteNumber?: string;
  orderDate: string;
  invoiceDate: string;
  shipDate: string;
  buyerName?: string;
  shipViaRaw?: string;
  jobNumberRaw?: string;
  vendorBranchName: string;
  vendorBranchAddress: string;
  vendorBranchPhone: string;
  soldToName: string;
  shipToName: string;
  shipToAddress: string;
  fulfillmentMethod: InvoiceFulfillmentMethod;
}

export interface ParsedInvoiceLine {
  lineNumber: number;
  quantityOrdered: number;
  quantityShipped: number;
  quantityBackordered: number;
  vendorProductNumber: string;
  manufacturerOrModelNumber?: string;
  description: string;
  filteredNotes: string[];
  lineType: InvoiceLineType;
  excludeFromExpectedItems: boolean;
}

export interface ParsedJohnstoneInvoice {
  header: ParsedInvoiceHeader;
  lines: ParsedInvoiceLine[];
  orderNotes: string[];
  parseWarnings: string[];
}

export interface InvoiceProcessingResult {
  page: JohnstoneInvoicePageText;
  parsed: ParsedJohnstoneInvoice;
  importStatus: VendorInvoiceImportStatus;
  confidenceTier: InvoiceConfidenceTier;
  confidenceScore: number;
  humanReviewRequired: boolean;
  duplicate: boolean;
  duplicateOfPageId?: string;
  reviewStatus: "pending_review" | "approved" | "rejected" | "auto_processed";
}

export const INVOICE_AUTO_APPLY_CONFIDENCE = 85;
export const INVOICE_REVIEW_CONFIDENCE = 60;
