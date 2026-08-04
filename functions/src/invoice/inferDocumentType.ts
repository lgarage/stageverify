/**
 * Infer document type from stored parse output (CF ingest + ignore fingerprints).
 * Mirrors src/dispatcher/invoice/inferDocumentType.ts — keep in sync.
 */
import { isCreditReturnImportDoc } from "./creditReturnSkip";
import type { VendorInvoiceImportParsedLine } from "../inboundEmail/types";

export type InvoiceDocumentType =
  | "sales_order_confirmation"
  | "invoice"
  | "credit_memo"
  | "unknown";

export type InvoiceParserFormatId =
  | "johnstone"
  | "first_supply"
  | "generic"
  | "unknown";

const DOC_TYPE_LABELS: Record<InvoiceDocumentType, string> = {
  sales_order_confirmation: "Sales order confirmation (S/O)",
  invoice: "Invoice",
  credit_memo: "Credit memo (CREDIT)",
  unknown: "Unknown document type",
};

export function documentTypeLabel(docType: InvoiceDocumentType): string {
  return DOC_TYPE_LABELS[docType] ?? DOC_TYPE_LABELS.unknown;
}

function asNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function headerField(
  header: Record<string, unknown> | undefined,
  key: string,
): string {
  if (!header) return "";
  return asNonEmptyString(header[key]);
}

export function normalizeParserFormatId(raw: unknown): InvoiceParserFormatId {
  if (raw === "johnstone" || raw === "first_supply" || raw === "generic") {
    return raw;
  }
  return "unknown";
}

export type InferDocumentTypeInput = {
  skipReason?: string;
  parsedHeader?: Record<string, unknown>;
  parsedLines?: VendorInvoiceImportParsedLine[];
  orderNotes?: string[];
  parseWarnings?: string[];
  importStatus?: string;
  pageId?: string;
};

export function inferDocumentType(
  importRow: InferDocumentTypeInput,
): InvoiceDocumentType {
  if (
    importRow.skipReason === "credit_return" ||
    isCreditReturnImportDoc({
      parsedHeader: importRow.parsedHeader,
      parsedLines: importRow.parsedLines,
      orderNotes: importRow.orderNotes,
    })
  ) {
    return "credit_memo";
  }

  const invoiceNum = headerField(importRow.parsedHeader, "vendorInvoiceNumber");
  const orderNum = headerField(importRow.parsedHeader, "vendorOrderNumber");
  const warnings = (importRow.parseWarnings ?? []).map((w) => w.toLowerCase());
  const missingInvoiceWarning = warnings.some((w) =>
    w.includes("missing vendorinvoicenumber"),
  );
  const pageId = asNonEmptyString(importRow.pageId);

  if (invoiceNum) return "invoice";

  if (
    orderNum &&
    (missingInvoiceWarning || importRow.importStatus === "issue")
  ) {
    return "sales_order_confirmation";
  }

  if (/^inv-so-/i.test(pageId) || /\bso[-#]/i.test(pageId)) {
    return "sales_order_confirmation";
  }

  if (orderNum && !invoiceNum) {
    return "sales_order_confirmation";
  }

  if (orderNum) return "invoice";

  return "unknown";
}
