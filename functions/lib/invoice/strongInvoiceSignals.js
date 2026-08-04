"use strict";
/** D-59 P4 — strong invoice signals block auto-ignore (§13). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRONG_INVOICE_SIGNALS_REASON = void 0;
exports.hasStrongInvoiceSignals = hasStrongInvoiceSignals;
exports.STRONG_INVOICE_SIGNALS_REASON = "strong_invoice_signals";
const STRONG_INVOICE_TEXT_PATTERN = /\b(amount\s+due|balance\s+due|remit\s+to|payment\s+terms|total\s+due)\b/i;
function hasStrongInvoiceSignals(input) {
    const invoiceNum = (input.vendorInvoiceNumber ?? "").trim();
    if (invoiceNum.length > 0)
        return true;
    const text = input.extractedText ?? "";
    return STRONG_INVOICE_TEXT_PATTERN.test(text);
}
//# sourceMappingURL=strongInvoiceSignals.js.map