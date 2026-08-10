"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOHNSTONE_LABEL_ANCHORS = exports.C3D1_ALLOWED_PARSER_FORMAT_ID = void 0;
exports.normalizeAnchorMatchText = normalizeAnchorMatchText;
exports.getApprovedAnchorForC3D1 = getApprovedAnchorForC3D1;
exports.findLiteralOccurrences = findLiteralOccurrences;
exports.lineEqualsApprovedLiteral = lineEqualsApprovedLiteral;
/** Gate: only parserFormatId johnstone. vendorKey may be johnstone-supply etc. */
exports.C3D1_ALLOWED_PARSER_FORMAT_ID = "johnstone";
/**
 * Approved literals for C3-D.1 v1 (Dan 2026-08-10 — P2 A-only).
 * Keyed by field; enabled only when parserFormatId === johnstone.
 */
exports.JOHNSTONE_LABEL_ANCHORS = {
    customerPoOrReference: {
        literal: "Customer P/O #",
        anchorKey: "johnstone_customer_po_v1",
    },
    vendorOrderNumber: {
        literal: "Sales Order #",
        anchorKey: "johnstone_sales_order_v1",
    },
    vendorInvoiceNumber: {
        literal: "Invoice #",
        anchorKey: "johnstone_invoice_num_v1",
    },
};
/** Collapse whitespace + case-fold for structure compare — never strips "#" or "/". */
function normalizeAnchorMatchText(raw) {
    return raw.replace(/\s+/g, " ").trim().toUpperCase();
}
function getApprovedAnchorForC3D1(input) {
    if (input.parserFormatId !== exports.C3D1_ALLOWED_PARSER_FORMAT_ID)
        return null;
    if (input.field !== "customerPoOrReference" &&
        input.field !== "vendorOrderNumber" &&
        input.field !== "vendorInvoiceNumber") {
        return null;
    }
    return exports.JOHNSTONE_LABEL_ANCHORS[input.field];
}
/**
 * Find case-folded exact-structure matches of an approved literal in haystack.
 * Allows flexible internal whitespace; requires every non-space char of the literal
 * (including "/" and "#") in order.
 */
function findLiteralOccurrences(haystack, literal) {
    const litNorm = normalizeAnchorMatchText(literal);
    if (!litNorm)
        return [];
    const litChars = [...litNorm];
    const out = [];
    const n = haystack.length;
    for (let i = 0; i < n; i += 1) {
        let hi = i;
        let li = 0;
        const start = i;
        while (li < litChars.length && hi < n) {
            const hCh = haystack[hi];
            const lCh = litChars[li];
            if (lCh === " ") {
                if (/\s/.test(hCh)) {
                    while (hi < n && /\s/.test(haystack[hi]))
                        hi += 1;
                    li += 1;
                    continue;
                }
                break;
            }
            if (hCh.toUpperCase() === lCh) {
                hi += 1;
                li += 1;
                continue;
            }
            if (/\s/.test(hCh) && li > 0) {
                // skip extra whitespace between literal tokens
                hi += 1;
                continue;
            }
            break;
        }
        if (li === litChars.length) {
            out.push({ start, end: hi, matched: haystack.slice(start, hi) });
            i = hi - 1;
        }
    }
    return out;
}
/** True iff line (trimmed) equals the approved literal under case-fold + space collapse. */
function lineEqualsApprovedLiteral(line, literal) {
    return normalizeAnchorMatchText(line) === normalizeAnchorMatchText(literal);
}
//# sourceMappingURL=labelAnchorAllowlist.js.map