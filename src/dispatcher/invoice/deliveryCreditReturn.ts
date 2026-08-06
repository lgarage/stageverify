import type { VendorInvoiceImportReview } from "../models";
import { isCreditReturnImportDoc } from "./creditReturnSkip";
import { inferDocumentType } from "./inferDocumentType";
import {
  buildRejectLessonNote,
  type InvoiceRejectReasonId,
} from "./invoiceRejectReasons";

type CreditDetectionImportRow = Pick<
  VendorInvoiceImportReview,
  "reviewStatus" | "parsedHeader" | "parsedLines" | "orderNotes" | "skipReason"
> &
  Partial<
    Pick<
      VendorInvoiceImportReview,
      "reviewRequiredReasons" | "parseWarnings" | "importStatus" | "pageId"
    >
  >;

function importReviewFlagsCreditReturn(
  importRow: Pick<VendorInvoiceImportReview, "reviewRequiredReasons">,
): boolean {
  return (importRow.reviewRequiredReasons ?? []).some((reason) =>
    /credit\/return/i.test(reason),
  );
}

/** Linked import is a credit/return memo — not valid for staging or pickup. */
export function isCreditReturnLinkedImport(
  importRow: CreditDetectionImportRow,
): boolean {
  if (importRow.skipReason === "credit_return") return true;
  if (importReviewFlagsCreditReturn(importRow)) return true;
  if (inferDocumentType(importRow as VendorInvoiceImportReview) === "credit_memo") {
    return true;
  }
  return isCreditReturnImportDoc(importRow);
}

/** Mirrors CF approveVendorInvoiceImport canRejectReviewStatus. */
export function canRejectLinkedImport(
  importRow: CreditDetectionImportRow,
): boolean {
  if (importRow.reviewStatus === "pending_review") return true;
  if (importRow.reviewStatus === "approved") {
    return isCreditReturnLinkedImport(importRow);
  }
  return false;
}

export function linkedImportRejectBlockedReason(
  importRow: VendorInvoiceImportReview | null,
  importId: string | undefined,
): string | null {
  if (!importId?.trim()) {
    return "No linked invoice import — reject is only available for invoice-created deliveries.";
  }
  if (!importRow) return null;
  if (importRow.reviewStatus === "rejected") {
    return "Linked import is already in Rejected Invoices.";
  }
  if (!canRejectLinkedImport(importRow)) {
    return `Linked import is ${importRow.reviewStatus} — only pending or credit/return slip-through imports can be rejected here.`;
  }
  return null;
}

/** Training lesson when rejecting a credit/return from the delivery drawer. */
export function buildDeliveryDrawerRejectLessonNote(
  reasonId: InvoiceRejectReasonId,
  detailText: string,
): string {
  if (reasonId === "credit_return") {
    const detail = detailText.trim();
    const base =
      "Credit/return memo slipped into deliveries — do not stage or assign pickup. Ignore credit/return memos so they never land as Will-Call Ready deliveries.";
    if (detail) return `${base} ${detail}`;
    return base;
  }
  return buildRejectLessonNote(reasonId, detailText);
}
