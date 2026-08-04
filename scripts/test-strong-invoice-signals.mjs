/**
 * Unit checks for D-59 P4 strong invoice signal guard (no live Firebase).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "functions", "package.json"));

const {
  hasStrongInvoiceSignals,
  STRONG_INVOICE_SIGNALS_REASON,
} = require(path.join(root, "functions/lib/invoice/strongInvoiceSignals.js"));

assert.equal(STRONG_INVOICE_SIGNALS_REASON, "strong_invoice_signals");

assert.equal(
  hasStrongInvoiceSignals({ vendorInvoiceNumber: "  INV-9912  ", extractedText: "" }),
  true,
  "trimmed non-empty vendorInvoiceNumber → true",
);

assert.equal(
  hasStrongInvoiceSignals({
    vendorInvoiceNumber: "",
    extractedText: "Please remit to Johnstone Supply within 30 days.",
  }),
  true,
  "amount-due wording → true",
);

assert.equal(
  hasStrongInvoiceSignals({
    vendorInvoiceNumber: "",
    extractedText: "SALES ORDER CONFIRMATION\nShip Via: UPS\nLine 1 Qty 2",
  }),
  false,
  "S/O without signals → false",
);

assert.equal(
  hasStrongInvoiceSignals({
    vendorInvoiceNumber: "",
    extractedText: "Line 1  Widget  Qty 2\nLine 2  Gasket  Qty 1",
  }),
  false,
  "line items alone → false",
);

assert.equal(
  hasStrongInvoiceSignals({
    vendorInvoiceNumber: "CM-44102",
    extractedText: "CREDIT MEMO\nBranch: CREDIT\nReturn from invoice 12345",
  }),
  true,
  "credit_memo text + invoice# → true (near-miss)",
);

assert.equal(
  hasStrongInvoiceSignals({ vendorInvoiceNumber: "   ", extractedText: "CREDIT MEMO" }),
  false,
  "whitespace-only invoice# without text signals → false",
);

assert.equal(
  hasStrongInvoiceSignals({
    vendorInvoiceNumber: "",
    extractedText: "Total Due: $1,234.56",
  }),
  true,
  "total due wording → true",
);

console.log("test-strong-invoice-signals: PASS");
