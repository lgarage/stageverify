/** Human labels for invoice delivery match reason tokens (matchInvoiceToRecords.ts). */
export const INVOICE_MATCH_REASON_LABELS: Record<string, string> = {
  exact_po_number: "Exact PO number match",
  ambiguous_po_multiple_records: "Multiple PO records matched",
  po_hint_not_found: "PO hint not found",
  exact_customer_po_reference: "Exact customer PO reference",
  exact_order_number: "Exact order number match",
  ambiguous_order_number: "Multiple order numbers matched",
  sales_order_in_delivery_context: "Sales order found in delivery context",
  exact_job_number: "Exact job number match",
  job_number_delivery: "Job number linked to delivery",
  ambiguous_job_number: "Multiple job numbers matched",
  customer_po_in_delivery_notes: "Customer PO in delivery notes",
  multiple_delivery_candidates: "Multiple delivery candidates",
  insufficient_signals: "Insufficient match signals",
};

export function labelInvoiceMatchReason(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return trimmed;
  const label = INVOICE_MATCH_REASON_LABELS[trimmed];
  if (label) return label;
  return trimmed.replace(/_/g, " ").trim();
}

/** Format confidenceReason (semicolon-separated tokens). */
export function formatInvoiceMatchReasons(reason: string): string {
  if (!reason.trim()) return labelInvoiceMatchReason("insufficient_signals");
  return reason
    .split(";")
    .map((t) => labelInvoiceMatchReason(t))
    .filter(Boolean)
    .join(` ${"\u00B7"} `);
}

/** Format candidate matchReasons array. */
export function formatInvoiceMatchReasonList(reasons: string[]): string {
  return reasons.map((t) => labelInvoiceMatchReason(t)).filter(Boolean).join(` ${"\u00B7"} `);
}
