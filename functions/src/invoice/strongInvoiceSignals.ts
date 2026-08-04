/** D-59 P4 — strong invoice signals block auto-ignore (§13). */

export const STRONG_INVOICE_SIGNALS_REASON = "strong_invoice_signals" as const;

const STRONG_INVOICE_TEXT_PATTERN =
  /\b(amount\s+due|balance\s+due|remit\s+to|payment\s+terms|total\s+due)\b/i;

export function hasStrongInvoiceSignals(input: {
  vendorInvoiceNumber?: string | null;
  extractedText?: string | null;
}): boolean {
  const invoiceNum = (input.vendorInvoiceNumber ?? "").trim();
  if (invoiceNum.length > 0) return true;
  const text = input.extractedText ?? "";
  return STRONG_INVOICE_TEXT_PATTERN.test(text);
}
