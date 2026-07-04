import type { VendorInvoiceImportReview } from "../models";

/** Canonical ParsedInvoiceHeader keys → human labels for review + inspect UI. */
export const INVOICE_HEADER_FIELD_LABELS: Record<string, string> = {
  customerAccountNumber: "Customer #",
  vendorOrderNumber: "Sales order #",
  vendorInvoiceNumber: "Invoice #",
  customerPoOrReference: "Customer P/O #",
  quoteNumber: "Quote #",
  orderDate: "Order date",
  invoiceDate: "Invoice date",
  shipDate: "Ship date",
  buyerName: "Buyer",
  shipViaRaw: "Ship via",
  jobNumberRaw: "Job #",
  vendorBranchName: "Branch",
  vendorBranchAddress: "Branch address",
  vendorBranchPhone: "Branch phone",
  soldToName: "Sold to",
  shipToName: "Ship to",
  shipToAddress: "Ship to address",
  fulfillmentMethod: "Fulfillment",
  shipCompletePolicy: "Ship-complete policy",
};

const HEADER_ALIASES: Record<string, readonly string[]> = {
  customerPoOrReference: [
    "customerPoOrReference",
    "customerPo",
    "customerPO",
    "customer_po_or_reference",
  ],
  buyerName: ["buyerName", "buyer"],
  vendorOrderNumber: ["vendorOrderNumber", "salesOrderNumber", "salesOrder"],
  vendorInvoiceNumber: ["vendorInvoiceNumber", "invoiceNumber"],
  vendorBranchName: ["vendorBranchName", "branchName"],
  vendorBranchPhone: ["vendorBranchPhone", "branchPhone"],
};

function coerceHeaderValue(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

/** Unwrap parsedHeader when nested under `.header` (legacy / bad writes). */
export function normalizeParsedHeader(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const nested = raw.header;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...raw, ...(nested as Record<string, unknown>) };
  }
  return raw;
}

export function readInvoiceHeaderField(
  header: Record<string, unknown> | undefined,
  canonicalKey: string,
): string {
  const normalized = normalizeParsedHeader(header);
  const keys = HEADER_ALIASES[canonicalKey] ?? [canonicalKey];
  for (const key of keys) {
    const value = coerceHeaderValue(normalized[key]);
    if (value) return value;
  }
  return "";
}

export function formatInvoiceHeaderField(value: string): string {
  return value.trim() ? value.trim() : "—";
}

/** Primary header fields shown in the review detail grid (Confidence excluded). */
export const INVOICE_REVIEW_DETAIL_FIELDS = [
  "customerPoOrReference",
  "vendorOrderNumber",
  "vendorInvoiceNumber",
  "buyerName",
  "vendorBranchName",
  "orderDate",
  "shipViaRaw",
  "jobNumberRaw",
  "soldToName",
] as const;

export function buildHeaderDisplayRows(
  header: Record<string, unknown> | undefined,
): { key: string; label: string; value: string }[] {
  const normalized = normalizeParsedHeader(header);
  const rows: { key: string; label: string; value: string }[] = [];
  const seen = new Set<string>();

  for (const key of Object.keys(INVOICE_HEADER_FIELD_LABELS)) {
    const value = readInvoiceHeaderField(normalized, key);
    if (!value) continue;
    rows.push({
      key,
      label: INVOICE_HEADER_FIELD_LABELS[key] ?? key,
      value,
    });
    seen.add(key);
  }

  for (const [key, rawValue] of Object.entries(normalized)) {
    if (seen.has(key) || key === "header") continue;
    const value = coerceHeaderValue(rawValue);
    if (!value) continue;
    rows.push({
      key,
      label: INVOICE_HEADER_FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim(),
      value,
    });
  }

  return rows;
}

export function queueRowTitle(importRow: VendorInvoiceImportReview): string {
  const header = importRow.parsedHeader;
  const invoiceNum = readInvoiceHeaderField(header, "vendorInvoiceNumber");
  const orderNum = readInvoiceHeaderField(header, "vendorOrderNumber");
  if (invoiceNum) return `Invoice ${invoiceNum}`;
  if (orderNum) return `S/O ${orderNum}`;
  return importRow.pageId;
}

export function queueRowSubtitle(importRow: VendorInvoiceImportReview): string {
  const po = readInvoiceHeaderField(importRow.parsedHeader, "customerPoOrReference");
  if (po) return po;
  const orderNum = readInvoiceHeaderField(importRow.parsedHeader, "vendorOrderNumber");
  if (orderNum) return `Sales order ${orderNum}`;
  return importRow.importBatchId;
}

/** One-line issue/warning summary for queue rows. */
export function queueRowIssueSummary(importRow: VendorInvoiceImportReview): string {
  const error = importRow.error?.trim();
  if (error) return error;
  const warnings = (importRow.parseWarnings ?? []).filter(Boolean);
  if (warnings.length > 0) return warnings.join("; ");
  if (importRow.importStatus === "issue") {
    return "Parse issue — missing required fields (e.g. Invoice # on S/O confirmation).";
  }
  return "";
}

export function queueRowLineCount(importRow: VendorInvoiceImportReview): number {
  if (typeof importRow.parsedLineCount === "number") return importRow.parsedLineCount;
  return importRow.parsedLines?.length ?? 0;
}
