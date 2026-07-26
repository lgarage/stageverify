"use strict";
/** Deterministic gates for AI shadow parse — qty-only (no AP dollars). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCorruptExtractedText = isCorruptExtractedText;
exports.validateAiShadowOutput = validateAiShadowOutput;
exports.qtyLinesMatchRegex = qtyLinesMatchRegex;
const CUSTOM_FONT_MARKERS = /\/(FontFile|ToUnicode)|cid:|\\u00[0-9a-f]{2}/i;
function isCorruptExtractedText(text) {
    const t = text.trim();
    if (t.length < 40)
        return true;
    const printable = t.replace(/[\s\w.,#/$-]/g, "");
    if (printable.length > t.length * 0.35)
        return true;
    if (CUSTOM_FONT_MARKERS.test(t) && !/\bINVOICE\b/i.test(t))
        return true;
    return false;
}
function isFiniteNonNeg(n) {
    return typeof n === "number" && Number.isFinite(n) && n >= 0;
}
function validateAiShadowOutput(raw, options) {
    const failures = [];
    if (!raw || typeof raw !== "object") {
        return { ok: false, failures: ["json_schema_failure"] };
    }
    const obj = raw;
    const header = obj.header;
    const lines = obj.lines;
    if (!header || typeof header !== "object" || !Array.isArray(lines)) {
        return { ok: false, failures: ["json_schema_failure"] };
    }
    const h = header;
    if (!h.vendorInvoiceNumber?.trim() || !h.vendorOrderNumber?.trim()) {
        failures.push("missing_required_fields");
    }
    const productLines = lines.filter((ln) => {
        if (!ln || typeof ln !== "object")
            return false;
        const t = ln.lineType;
        return !t || t === "product";
    });
    if (productLines.length === 0) {
        failures.push("missing_required_fields");
    }
    let qtyOk = true;
    for (const ln of productLines) {
        if (!isFiniteNonNeg(ln.quantityOrdered) ||
            !isFiniteNonNeg(ln.quantityShipped) ||
            !isFiniteNonNeg(ln.quantityBackordered)) {
            qtyOk = false;
            break;
        }
        const sum = ln.quantityShipped + ln.quantityBackordered;
        // Allow small float noise; integers expected
        if (Math.abs(sum - ln.quantityOrdered) > 0.001) {
            qtyOk = false;
            break;
        }
    }
    if (!qtyOk)
        failures.push("qty_reconcile_failure");
    const inv = (h.vendorInvoiceNumber ?? "").trim();
    const ord = (h.vendorOrderNumber ?? "").trim();
    if (inv && ord && inv === ord) {
        failures.push("conflicting_identity");
    }
    if (!options.hasVendorPlaybook &&
        options.parserFormatId !== "johnstone" &&
        options.parserFormatId !== "first_supply") {
        failures.push("unknown_vendor_layout");
    }
    const evidence = obj.evidenceNotes;
    if (!Array.isArray(evidence) ||
        evidence.filter((e) => typeof e === "string" && e.trim().length >= 4).length < 1) {
        failures.push("weak_source_evidence");
    }
    const fm = h.fulfillmentMethod;
    if (fm !== "delivery" && fm !== "will_call_pickup" && fm !== "unknown") {
        failures.push("unclear_fulfillment");
    }
    else if (fm === "unknown") {
        failures.push("unclear_fulfillment");
    }
    return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
/** Qty-only compare of AI product lines vs regex parse (shadow metric). */
function qtyLinesMatchRegex(ai, regexLines) {
    const a = ai.lines.filter((l) => !l.lineType || l.lineType === "product");
    const r = regexLines.filter((l) => (!l.lineType || l.lineType === "product") && !l.excludeFromExpectedItems);
    if (a.length !== r.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].quantityOrdered !== r[i].quantityOrdered ||
            a[i].quantityShipped !== r[i].quantityShipped ||
            a[i].quantityBackordered !== r[i].quantityBackordered) {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=validateAiParse.js.map