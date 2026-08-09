"use strict";
/**
 * Lane C C2 — smallest safe allowlist for current-import field correction.
 * Uncertainty → exclude (buyerName, vendorBranchName, orderDate deferred).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CORRECTION_AUDIT_COLLECTION = exports.FIELD_ALIASES = exports.FIELD_DISPLAY_LABELS = exports.INVOICE_CORRECTABLE_FIELD_KEYS = void 0;
exports.isCorrectableFieldKey = isCorrectableFieldKey;
exports.normalizeFieldAlias = normalizeFieldAlias;
exports.correctionAuditDocId = correctionAuditDocId;
exports.headerFieldAsString = headerFieldAsString;
exports.INVOICE_CORRECTABLE_FIELD_KEYS = [
    "customerPoOrReference",
    "vendorOrderNumber",
    "vendorInvoiceNumber",
];
exports.FIELD_DISPLAY_LABELS = {
    customerPoOrReference: "Customer PO",
    vendorOrderNumber: "Vendor order #",
    vendorInvoiceNumber: "Invoice #",
};
/** Aliases the classifier / model may use → canonical field key. */
exports.FIELD_ALIASES = {
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
exports.CORRECTION_AUDIT_COLLECTION = "vendorInvoiceFieldCorrections";
function isCorrectableFieldKey(value) {
    return (typeof value === "string" &&
        exports.INVOICE_CORRECTABLE_FIELD_KEYS.includes(value));
}
function normalizeFieldAlias(raw) {
    const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
    return exports.FIELD_ALIASES[key] ?? null;
}
function correctionAuditDocId(importId, field, sourceMessageId) {
    return `${importId}__${field}__${sourceMessageId}`;
}
function headerFieldAsString(parsedHeader, field) {
    if (!parsedHeader || typeof parsedHeader !== "object" || Array.isArray(parsedHeader)) {
        return "";
    }
    const v = parsedHeader[field];
    if (typeof v === "string")
        return v.trim();
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    return "";
}
//# sourceMappingURL=correctionAllowlist.js.map