"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextWindows = extractTextWindows;
exports.buildReviewAgentContextPacket = buildReviewAgentContextPacket;
exports.findEvidenceSpan = findEvidenceSpan;
/**
 * Build the smallest useful review context packet for Lane C C1.
 * Amendment 2: not extracted text alone — parsed fields + warnings + windows + chat.
 */
const constants_1 = require("../aiShadow/constants");
const correctionAllowlist_1 = require("./correctionAllowlist");
const HEADER_KEYS = [
    "vendorInvoiceNumber",
    "vendorOrderNumber",
    "customerPoOrReference",
    "fulfillmentMethod",
    "shipVia",
    "invoiceDate",
    "vendorName",
    "jobName",
    "jobNumber",
];
function asRecord(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function subsetHeader(parsedHeader) {
    const src = asRecord(parsedHeader);
    const out = {};
    for (const key of HEADER_KEYS) {
        if (key in src)
            out[key] = src[key];
    }
    return out;
}
function tokenizeQuery(message) {
    return message
        .toUpperCase()
        .replace(/[^A-Z0-9\s./-]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
        .slice(0, 12);
}
/** Find bounded windows around query tokens in extracted invoice text. */
function extractTextWindows(combinedExtractedText, message) {
    const text = combinedExtractedText ?? "";
    if (!text.trim())
        return [];
    const upper = text.toUpperCase();
    const tokens = tokenizeQuery(message);
    const hits = [];
    for (const token of tokens) {
        let from = 0;
        while (hits.length < 20) {
            const idx = upper.indexOf(token, from);
            if (idx < 0)
                break;
            hits.push(idx);
            from = idx + token.length;
        }
    }
    // Always include a head window so the agent has invoice identity context.
    if (hits.length === 0) {
        const end = Math.min(text.length, constants_1.REVIEW_CHAT_TEXT_WINDOW_CHARS);
        return end > 0 ? [{ start: 0, end, text: text.slice(0, end) }] : [];
    }
    const half = Math.floor(constants_1.REVIEW_CHAT_TEXT_WINDOW_CHARS / 2);
    const windows = [];
    const used = [];
    for (const hit of hits) {
        if (windows.length >= constants_1.REVIEW_CHAT_MAX_TEXT_WINDOWS)
            break;
        const start = Math.max(0, hit - half);
        const end = Math.min(text.length, hit + half);
        const overlaps = used.some((u) => !(end < u.start - 40 || start > u.end + 40));
        if (overlaps)
            continue;
        used.push({ start, end });
        windows.push({ start, end, text: text.slice(start, end) });
    }
    return windows;
}
function pickRelevantLines(parsedLines, message) {
    if (!Array.isArray(parsedLines))
        return [];
    const tokens = tokenizeQuery(message);
    const rows = parsedLines
        .filter((row) => row && typeof row === "object")
        .map((row) => row);
    const scored = rows.map((row, index) => {
        const blob = JSON.stringify(row).toUpperCase();
        let score = 0;
        for (const token of tokens) {
            if (blob.includes(token))
                score += 1;
        }
        return { row, index, score };
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const picked = scored.some((s) => s.score > 0)
        ? scored.filter((s) => s.score > 0).slice(0, constants_1.REVIEW_CHAT_MAX_LINES)
        : scored.slice(0, Math.min(6, constants_1.REVIEW_CHAT_MAX_LINES));
    return picked.map((p) => ({
        lineIndex: p.index,
        vendorProductNumber: p.row.vendorProductNumber ?? null,
        description: p.row.description ?? null,
        quantityOrdered: p.row.quantityOrdered ?? null,
        quantityShipped: p.row.quantityShipped ?? null,
        quantityBackordered: p.row.quantityBackordered ?? null,
        lineType: p.row.lineType ?? null,
    }));
}
function buildReviewAgentContextPacket(input) {
    const parseWarnings = Array.isArray(input.parseWarnings)
        ? input.parseWarnings.filter((w) => typeof w === "string")
        : [];
    const reviewIssues = [];
    if (typeof input.error === "string" && input.error.trim()) {
        reviewIssues.push(input.error.trim());
    }
    if (Array.isArray(input.reviewRequiredReasons)) {
        for (const r of input.reviewRequiredReasons) {
            if (typeof r === "string" && r.trim())
                reviewIssues.push(r.trim());
        }
    }
    const recentTurns = input.recentTurns.slice(-constants_1.REVIEW_CHAT_RECENT_TURNS);
    const packet = {
        parsedHeader: subsetHeader(input.parsedHeader),
        relevantLines: pickRelevantLines(input.parsedLines, input.dispatcherMessage),
        parseWarnings,
        reviewIssues,
        textWindows: extractTextWindows(input.combinedExtractedText, input.dispatcherMessage),
        recentTurns,
        rollingSummary: (input.rollingSummary || "").slice(0, 1_500),
        sourceTextAvailable: Boolean(input.combinedExtractedText?.trim()),
        correctableFields: [...correctionAllowlist_1.INVOICE_CORRECTABLE_FIELD_KEYS],
    };
    // Soft-trim if serialized packet is oversized.
    let serialized = JSON.stringify(packet);
    while (serialized.length > constants_1.MAX_REVIEW_CHAT_CONTEXT_CHARS &&
        packet.relevantLines.length > 2) {
        packet.relevantLines.pop();
        serialized = JSON.stringify(packet);
    }
    while (serialized.length > constants_1.MAX_REVIEW_CHAT_CONTEXT_CHARS &&
        packet.textWindows.length > 1) {
        packet.textWindows.pop();
        serialized = JSON.stringify(packet);
    }
    if (serialized.length > constants_1.MAX_REVIEW_CHAT_CONTEXT_CHARS) {
        packet.rollingSummary = packet.rollingSummary.slice(0, 400);
    }
    return packet;
}
/** Locate a cited snippet in extracted text; returns offsets or null. */
function findEvidenceSpan(combinedExtractedText, citationText) {
    const hay = combinedExtractedText ?? "";
    const needle = (citationText ?? "").trim();
    if (!hay || !needle)
        return null;
    const direct = hay.indexOf(needle);
    if (direct >= 0) {
        return { start: direct, end: direct + needle.length, matched: needle };
    }
    const hayU = hay.toUpperCase();
    const needleU = needle.toUpperCase();
    const idx = hayU.indexOf(needleU);
    if (idx >= 0) {
        return {
            start: idx,
            end: idx + needle.length,
            matched: hay.slice(idx, idx + needle.length),
        };
    }
    // Collapse whitespace for a looser match.
    const compactHay = hayU.replace(/\s+/g, " ");
    const compactNeedle = needleU.replace(/\s+/g, " ");
    const cIdx = compactHay.indexOf(compactNeedle);
    if (cIdx < 0)
        return null;
    // Approximate original offsets by scanning.
    let orig = 0;
    let compactPos = 0;
    while (orig < hay.length && compactPos < cIdx) {
        if (/\s/.test(hay[orig])) {
            while (orig < hay.length && /\s/.test(hay[orig]))
                orig += 1;
            compactPos += 1;
        }
        else {
            orig += 1;
            compactPos += 1;
        }
    }
    const start = orig;
    const end = Math.min(hay.length, start + needle.length);
    return { start, end, matched: hay.slice(start, end) };
}
//# sourceMappingURL=reviewAgentContext.js.map