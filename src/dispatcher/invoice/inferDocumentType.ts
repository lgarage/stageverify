import type { VendorInvoiceImportReview } from "../models";
import {
  normalizeParsedHeader,
  readInvoiceHeaderField,
} from "./invoiceReviewHeaderHelpers";

export type JohnstoneDocumentType =
  | "sales_order_confirmation"
  | "invoice"
  | "unknown";

const DOC_TYPE_LABELS: Record<JohnstoneDocumentType, string> = {
  sales_order_confirmation: "Sales order confirmation (S/O)",
  invoice: "Invoice",
  unknown: "Unknown document type",
};

export function documentTypeLabel(docType: JohnstoneDocumentType): string {
  return DOC_TYPE_LABELS[docType];
}

/**
 * Infer Johnstone PDF document type from stored parse output (no raw PDF text).
 * S/O confirmations lack Invoice #; full invoices include it.
 */
export function inferDocumentType(
  importRow: VendorInvoiceImportReview,
): JohnstoneDocumentType {
  const header = normalizeParsedHeader(importRow.parsedHeader);
  const invoiceNum = readInvoiceHeaderField(header, "vendorInvoiceNumber");
  const orderNum = readInvoiceHeaderField(header, "vendorOrderNumber");
  const warnings = (importRow.parseWarnings ?? []).map((w) => w.toLowerCase());
  const missingInvoiceWarning = warnings.some((w) =>
    w.includes("missing vendorinvoicenumber"),
  );

  if (invoiceNum) return "invoice";

  if (orderNum && (missingInvoiceWarning || importRow.importStatus === "issue")) {
    return "sales_order_confirmation";
  }

  if (/^inv-so-/i.test(importRow.pageId) || /\bso[-#]/i.test(importRow.pageId)) {
    return "sales_order_confirmation";
  }

  if (orderNum && !invoiceNum) {
    return "sales_order_confirmation";
  }

  if (orderNum) return "invoice";

  return "unknown";
}
