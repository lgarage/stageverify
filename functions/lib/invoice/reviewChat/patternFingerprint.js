"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvoiceAnchorDisqualifiedByReturnFrom = isInvoiceAnchorDisqualifiedByReturnFrom;
exports.buildPatternFingerprint = buildPatternFingerprint;
exports.deriveAnchorMatch = deriveAnchorMatch;
exports.describeApprovedAnchors = describeApprovedAnchors;
/**
 * Lane C C3-D.1 — derive patternFingerprint from value span + approved anchors.
 * Pure / no I/O. Value span ≠ label; missing/ambiguous → null (skip vote).
 */
const labelAnchorAllowlist_1 = require("./labelAnchorAllowlist");
const INLINE_MAX_GAP_CHARS = 30;
const INVOICE_RETURN_FROM_LOOKBACK = 24;
function splitLinesWithOffsets(text) {
    const lines = [];
    let start = 0;
    for (let i = 0; i <= text.length; i += 1) {
        if (i === text.length || text[i] === "\n") {
            const raw = text.slice(start, i);
            lines.push({ start, end: i, text: raw });
            start = i + 1;
        }
    }
    return lines;
}
function lineIndexForOffset(lines, offset) {
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (offset >= line.start && offset <= line.end)
            return i;
    }
    return -1;
}
/** Invoice # only: reject "Return from Invoice #" style body citations. */
function isInvoiceAnchorDisqualifiedByReturnFrom(haystack, matchStart) {
    const from = Math.max(0, matchStart - INVOICE_RETURN_FROM_LOOKBACK);
    const prefix = haystack.slice(from, matchStart);
    return /RETURN\s+FROM\s*$/i.test(prefix);
}
function buildPatternFingerprint(anchorKey, captureShapeId) {
    return `${anchorKey}__${captureShapeId}`;
}
function deriveAnchorMatch(input) {
    const entry = (0, labelAnchorAllowlist_1.getApprovedAnchorForC3D1)({
        parserFormatId: input.parserFormatId,
        field: input.field,
    });
    if (!entry) {
        if (input.parserFormatId !== "johnstone") {
            return { skipReason: "format_not_allowed" };
        }
        return { skipReason: "field_not_allowed" };
    }
    const field = input.field;
    const text = input.combinedExtractedText ?? "";
    if (!text.trim())
        return { skipReason: "missing_text" };
    const spanStart = input.evidenceSpanStart;
    const spanEnd = input.evidenceSpanEnd;
    if (typeof spanStart !== "number" ||
        typeof spanEnd !== "number" ||
        !Number.isFinite(spanStart) ||
        !Number.isFinite(spanEnd) ||
        spanStart < 0 ||
        spanEnd <= spanStart ||
        spanEnd > text.length) {
        return { skipReason: "missing_span" };
    }
    const lines = splitLinesWithOffsets(text);
    const valueLineIdx = lineIndexForOffset(lines, spanStart);
    if (valueLineIdx < 0)
        return { skipReason: "missing_span" };
    const valueLine = lines[valueLineIdx];
    const candidates = [];
    // 1) anchor_left_inline — literal on same line before the value
    const inlineOccs = (0, labelAnchorAllowlist_1.findLiteralOccurrences)(valueLine.text, entry.literal);
    const valueCol = spanStart - valueLine.start;
    for (const occ of inlineOccs) {
        if (occ.end > valueCol)
            continue;
        const gap = valueCol - occ.end;
        if (gap > INLINE_MAX_GAP_CHARS)
            continue;
        const absStart = valueLine.start + occ.start;
        if (field === "vendorInvoiceNumber" &&
            isInvoiceAnchorDisqualifiedByReturnFrom(text, absStart)) {
            return { skipReason: "invoice_window_rejected" };
        }
        candidates.push({
            field,
            literal: entry.literal,
            anchorKey: entry.anchorKey,
            captureShapeId: "anchor_left_inline",
            patternFingerprint: buildPatternFingerprint(entry.anchorKey, "anchor_left_inline"),
            matchedLiteral: occ.matched,
        });
    }
    // 2) anchor_above_line — previous line equals literal exactly (trimmed/case-fold)
    if (valueLineIdx > 0) {
        const prev = lines[valueLineIdx - 1];
        if ((0, labelAnchorAllowlist_1.lineEqualsApprovedLiteral)(prev.text, entry.literal)) {
            const absStart = prev.start + prev.text.search(/\S/);
            const start = absStart >= 0 ? absStart : prev.start;
            if (field === "vendorInvoiceNumber" &&
                isInvoiceAnchorDisqualifiedByReturnFrom(text, start)) {
                return { skipReason: "invoice_window_rejected" };
            }
            candidates.push({
                field,
                literal: entry.literal,
                anchorKey: entry.anchorKey,
                captureShapeId: "anchor_above_line",
                patternFingerprint: buildPatternFingerprint(entry.anchorKey, "anchor_above_line"),
                matchedLiteral: prev.text.trim(),
            });
        }
    }
    if (candidates.length === 0)
        return { skipReason: "no_anchor" };
    const fingerprints = new Set(candidates.map((c) => c.patternFingerprint));
    if (fingerprints.size > 1) {
        return { skipReason: "conflicting_anchors" };
    }
    if (candidates.length > 1) {
        // Same fingerprint twice (duplicate inline hits) — still one vote shape
        return candidates[0];
    }
    return candidates[0];
}
function describeApprovedAnchors() {
    return Object.entries(labelAnchorAllowlist_1.JOHNSTONE_LABEL_ANCHORS).map(([field, e]) => ({ field, ...e }));
}
//# sourceMappingURL=patternFingerprint.js.map