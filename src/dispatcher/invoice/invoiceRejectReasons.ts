/**
 * Known reject reasons for Parsed import data modal — seeded from document types,
 * credit/return advisories, parse/issue status, and duplicate flags in the product.
 */
export type InvoiceRejectReasonId =
  | "credit_return"
  | "sales_order_confirmation"
  | "duplicate"
  | "parse_issue"
  | "wrong_document_type"
  | "other";

export interface InvoiceRejectReasonOption {
  id: InvoiceRejectReasonId;
  label: string;
  /** Default training-lesson pattern when user does not add detail text. */
  lessonTemplate: string;
}

export const INVOICE_REJECT_REASON_OPTIONS: InvoiceRejectReasonOption[] = [
  {
    id: "credit_return",
    label: "Credit/Return",
    lessonTemplate:
      "Ignore credit/return memos — not valid delivery invoices.",
  },
  {
    id: "sales_order_confirmation",
    label: "Sales order confirmation (not invoice)",
    lessonTemplate:
      "Ignore sales order confirmations — wait for invoice with invoice number.",
  },
  {
    id: "duplicate",
    label: "Duplicate import",
    lessonTemplate: "Duplicate invoice — same message or page already processed.",
  },
  {
    id: "parse_issue",
    label: "Parse issues / bad data",
    lessonTemplate:
      "Reject when parse is unreliable — missing required fields or wrong layout.",
  },
  {
    id: "wrong_document_type",
    label: "Wrong document type",
    lessonTemplate:
      "Wrong document type for delivery import — not a shippable invoice.",
  },
  {
    id: "other",
    label: "Other",
    lessonTemplate: "",
  },
];

export function invoiceRejectReasonOption(
  id: InvoiceRejectReasonId,
): InvoiceRejectReasonOption {
  const found = INVOICE_REJECT_REASON_OPTIONS.find((o) => o.id === id);
  if (!found) {
    return INVOICE_REJECT_REASON_OPTIONS[INVOICE_REJECT_REASON_OPTIONS.length - 1];
  }
  return found;
}

/** Compose generalized training note for saveInvoiceTrainingLesson / reject+correctionNote. */
export function buildRejectLessonNote(
  reasonId: InvoiceRejectReasonId,
  detailText: string,
): string {
  const detail = detailText.trim();
  const option = invoiceRejectReasonOption(reasonId);
  if (reasonId === "other") {
    return detail;
  }
  if (detail) {
    return `${option.label}: ${detail}`;
  }
  return option.lessonTemplate;
}

export function rejectReasonConfirmEnabled(
  reasonId: InvoiceRejectReasonId | "",
  detailText: string,
): boolean {
  if (!reasonId) return false;
  if (reasonId === "other") return detailText.trim().length > 0;
  return true;
}

/** Pre-select credit/return when the pending advisory is visible. */
export function defaultRejectReasonId(
  hasCreditReturnAdvisory: boolean,
): InvoiceRejectReasonId | "" {
  return hasCreditReturnAdvisory ? "credit_return" : "";
}
