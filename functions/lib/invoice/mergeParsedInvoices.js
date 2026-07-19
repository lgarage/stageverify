"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeParsedInvoices = mergeParsedInvoices;
exports.specializedParseSucceeded = specializedParseSucceeded;
function mergeHeader(canonical, specialized) {
    const merged = { ...canonical };
    for (const [key, value] of Object.entries(specialized)) {
        if (typeof value === "string" && value.trim()) {
            merged[key] = value;
        }
        else if (typeof value === "boolean") {
            merged[key] = value;
        }
    }
    return merged;
}
function reconcileParseWarnings(merged, specialized) {
    const warnings = [];
    const productLines = merged.lines.filter((l) => l.lineType === "product" && !l.excludeFromExpectedItems);
    if (!merged.header.vendorInvoiceNumber)
        warnings.push("missing vendorInvoiceNumber");
    if (!merged.header.vendorOrderNumber && !merged.header.vendorInvoiceNumber) {
        warnings.push("missing vendorOrderNumber");
    }
    if (!merged.header.customerPoOrReference)
        warnings.push("missing customerPoOrReference");
    if (!merged.header.customerAccountNumber)
        warnings.push("uncertain:customerAccountNumber");
    if (!merged.header.vendorBranchName)
        warnings.push("uncertain:vendorBranchName");
    if (productLines.length === 0)
        warnings.push("missing product lines");
    if (merged.header.fulfillmentMethod === "unknown") {
        warnings.push("uncertain:fulfillmentMethod");
    }
    for (const w of specialized.parseWarnings) {
        if (!w.startsWith("missing") && !w.startsWith("uncertain:")) {
            warnings.push(w);
        }
    }
    return [...new Set(warnings)];
}
/** Prefer specialized parser output when present; fill gaps from canonical extraction. */
function mergeParsedInvoices(canonical, specialized) {
    const specializedProductLines = specialized.lines.filter((l) => l.lineType === "product" && !l.excludeFromExpectedItems);
    const canonicalProductLines = canonical.lines.filter((l) => l.lineType === "product" && !l.excludeFromExpectedItems);
    const lines = specializedProductLines.length >= canonicalProductLines.length
        ? specialized.lines
        : canonicalProductLines.length > 0
            ? canonical.lines
            : specialized.lines;
    const orderNotes = specialized.orderNotes.length > 0 ? specialized.orderNotes : canonical.orderNotes;
    const merged = {
        header: mergeHeader(canonical.header, specialized.header),
        lines,
        orderNotes,
        parseWarnings: specialized.parseWarnings,
    };
    merged.parseWarnings = reconcileParseWarnings(merged, specialized);
    return merged;
}
function specializedParseSucceeded(merged, formatId) {
    const productLines = merged.lines.filter((l) => l.lineType === "product" && !l.excludeFromExpectedItems);
    if (productLines.length === 0)
        return false;
    if (formatId === "first_supply") {
        return Boolean(merged.header.vendorInvoiceNumber);
    }
    return true;
}
//# sourceMappingURL=mergeParsedInvoices.js.map