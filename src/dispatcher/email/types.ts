/** Controlled inbound email shape for parser/matcher tests and future Gmail ingestion. */
export interface InboundEmailMessage {
  sourceMessageId: string;
  threadId?: string;
  senderEmail: string;
  recipientEmails: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
}

export type EmailClassification =
  | "ordered"
  | "order_acknowledged"
  | "backordered"
  | "partially_backordered"
  | "partially_shipped"
  | "shipped"
  | "split_shipment"
  | "delayed"
  | "estimated_delivery_changed"
  | "partially_delivered"
  | "delivered"
  | "remaining_items_delivered"
  | "vendor_order_complete"
  | "canceled_item"
  | "substituted_item"
  | "quantity_changed"
  | "needs_dispatcher_review"
  | "unable_to_match"
  | "irrelevant";

export interface ParsedEmailContent {
  classification: EmailClassification;
  poNumbers: string[];
  orderNumbers: string[];
  jobNumbers: string[];
  itemLines: Array<{ description: string; qty?: number }>;
  vendorOrderCompleteClaim: boolean;
  estimatedDeliveryDate?: string;
}

export interface EmailMatchCandidate {
  vendorId?: string;
  jobId?: string;
  purchaseOrderId?: string;
  deliveryOrderId?: string;
  confidenceScore: number;
  confidenceReason: string;
  humanReviewRequired: boolean;
}

export interface EmailProcessingResult {
  message: InboundEmailMessage;
  parsed: ParsedEmailContent;
  match: EmailMatchCandidate;
  duplicate: boolean;
  duplicateOfEventId?: string;
  reviewStatus: "pending_review" | "approved" | "rejected" | "auto_processed";
}

/** High-confidence auto-apply threshold (0–100). */
export const EMAIL_AUTO_APPLY_CONFIDENCE = 85;

/** Medium band routes to dispatcher review queue. */
export const EMAIL_REVIEW_CONFIDENCE = 60;
