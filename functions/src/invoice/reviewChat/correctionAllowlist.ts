/**
 * Lane C C2 — smallest safe allowlist for current-import field correction.
 * Uncertainty → exclude (buyerName, vendorBranchName, orderDate deferred).
 */

export const INVOICE_CORRECTABLE_FIELD_KEYS = [
  "customerPoOrReference",
  "vendorOrderNumber",
  "vendorInvoiceNumber",
] as const;

export type InvoiceCorrectableFieldKey =
  (typeof INVOICE_CORRECTABLE_FIELD_KEYS)[number];

export type ReviewCorrectionSourceType =
  | "document_evidence"
  | "dispatcher_assertion";

export type ReviewCorrectionStatus =
  | "proposed"
  | "applied"
  | "superseded"
  | "unresolvable";

export interface ReviewProposedCorrection {
  field: InvoiceCorrectableFieldKey;
  /** parsedHeader[field] at propose time — becomes expectedCurrentValue at apply. */
  currentValue: string;
  proposedValue: string;
  /** Propose-time label only; apply re-derives independently. */
  sourceType: ReviewCorrectionSourceType | "agent_interpretation";
}

export const FIELD_DISPLAY_LABELS: Record<InvoiceCorrectableFieldKey, string> = {
  customerPoOrReference: "Customer PO",
  vendorOrderNumber: "Vendor order #",
  vendorInvoiceNumber: "Invoice #",
};

/** Aliases the classifier / model may use → canonical field key. */
export const FIELD_ALIASES: Record<string, InvoiceCorrectableFieldKey> = {
  customerpoorreference: "customerPoOrReference",
  customerpo: "customerPoOrReference",
  customer_po: "customerPoOrReference",
  "customer p/o": "customerPoOrReference",
  "customer po": "customerPoOrReference",
  "customer p.o.": "customerPoOrReference",
  po: "customerPoOrReference",
  "p/o": "customerPoOrReference",
  "p.o.": "customerPoOrReference",
  "po #": "customerPoOrReference",
  "po number": "customerPoOrReference",
  vendorordernumber: "vendorOrderNumber",
  "vendor order number": "vendorOrderNumber",
  "vendor order #": "vendorOrderNumber",
  "order number": "vendorOrderNumber",
  "order #": "vendorOrderNumber",
  ordernumber: "vendorOrderNumber",
  so: "vendorOrderNumber",
  vendorinvoicenumber: "vendorInvoiceNumber",
  "vendor invoice number": "vendorInvoiceNumber",
  "invoice number": "vendorInvoiceNumber",
  "invoice #": "vendorInvoiceNumber",
  invoicenumber: "vendorInvoiceNumber",
  invoice: "vendorInvoiceNumber",
};

export const CORRECTION_AUDIT_COLLECTION = "vendorInvoiceFieldCorrections";

export function isCorrectableFieldKey(
  value: unknown,
): value is InvoiceCorrectableFieldKey {
  return (
    typeof value === "string" &&
    (INVOICE_CORRECTABLE_FIELD_KEYS as readonly string[]).includes(value)
  );
}

export function normalizeFieldAlias(
  raw: string,
): InvoiceCorrectableFieldKey | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return FIELD_ALIASES[key] ?? null;
}

export function correctionAuditDocId(
  importId: string,
  field: InvoiceCorrectableFieldKey,
  sourceMessageId: string,
): string {
  return `${importId}__${field}__${sourceMessageId}`;
}

export function headerFieldAsString(
  parsedHeader: unknown,
  field: InvoiceCorrectableFieldKey,
): string {
  if (!parsedHeader || typeof parsedHeader !== "object" || Array.isArray(parsedHeader)) {
    return "";
  }
  const v = (parsedHeader as Record<string, unknown>)[field];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
