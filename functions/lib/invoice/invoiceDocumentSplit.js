"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_INVOICE_DOCUMENTS_PER_EXTRACT = exports.PDF_ATTACHMENT_MARKER = exports.PDF_ATTACHMENT_BOUNDARY = void 0;
exports.isPlausibleInvoiceNumber = isPlausibleInvoiceNumber;
exports.extractHeaderInvoiceNumber = extractHeaderInvoiceNumber;
exports.splitExtractedTextIntoInvoiceDocuments = splitExtractedTextIntoInvoiceDocuments;
exports.preferredPreParseFormat = preferredPreParseFormat;
const pdfTextAdapter_1 = require("./pdfTextAdapter");
const vendorInvoiceRouter_1 = require("./vendorInvoiceRouter");
/** Inbound email joins multiple PDF extracts with this marker (see processInboundGmailMessage). */
exports.PDF_ATTACHMENT_BOUNDARY = "\n\n---PDF ATTACHMENT---\n\n";
exports.PDF_ATTACHMENT_MARKER = "---PDF ATTACHMENT---";
const HEADER_WINDOW_LINES = 25;
const MAX_VENDOR_HEADER_LOOKBACK = 15;
/** Cap logical invoices per extract — blocks review-queue amplification from crafted PDF text. */
exports.MAX_INVOICE_DOCUMENTS_PER_EXTRACT = 20;
function capInvoiceDocuments(documents) {
    if (documents.length <= exports.MAX_INVOICE_DOCUMENTS_PER_EXTRACT)
        return documents;
    return documents.slice(0, exports.MAX_INVOICE_DOCUMENTS_PER_EXTRACT);
}
const INVOICE_NUMBER_LABEL_PATTERNS = [
    /^\s*Invoice\s*#\s*:?\s*(.+)$/i,
    /^\s*Invoice\s+Number\s*:?\s*(.+)$/i,
    /^\s*Invoice\s+No\.?\s*:?\s*(.+)$/i,
];
function splitFirstSupplyInvoiceBlocks(text) {
    const parts = text
        .split(/\n(?=Invoice\n)/)
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.map((part) => (part.startsWith("Invoice") ? part : `Invoice\n${part}`));
}
function isPlausibleInvoiceNumber(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return false;
    if (!/\d/.test(trimmed))
        return false;
    if (/^(date|number|invoice|no\.?)$/i.test(trimmed))
        return false;
    return true;
}
/** Extract invoice # from the header window only — label-anchored, not mid-body references. */
function extractHeaderInvoiceNumber(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").slice(0, HEADER_WINDOW_LINES);
    for (const line of lines) {
        for (const pattern of INVOICE_NUMBER_LABEL_PATTERNS) {
            const match = line.match(pattern);
            if (match && isPlausibleInvoiceNumber(match[1])) {
                return match[1].trim();
            }
        }
        // First Supply puts "Invoice # 123" mid-line (e.g. after P.O. Box).
        const midLine = line.match(/Invoice\s*#\s*:?\s*([\w./-]+)/i);
        if (midLine && isPlausibleInvoiceNumber(midLine[1])) {
            return midLine[1].trim();
        }
    }
    return "";
}
function splitOnPhysicalBoundaries(text) {
    const normalized = text.replace(/\r\n/g, "\n");
    if (normalized.includes(exports.PDF_ATTACHMENT_BOUNDARY) ||
        normalized.includes(exports.PDF_ATTACHMENT_MARKER)) {
        return normalized
            .split(/\n\n---PDF ATTACHMENT---\n\n|---PDF ATTACHMENT---/)
            .map(pdfTextAdapter_1.normalizeExtractedPageText)
            .filter(Boolean);
    }
    if (normalized.includes(pdfTextAdapter_1.INVOICE_PAGE_BOUNDARY)) {
        return normalized
            .split(pdfTextAdapter_1.INVOICE_PAGE_BOUNDARY)
            .map(pdfTextAdapter_1.normalizeExtractedPageText)
            .filter(Boolean);
    }
    if (normalized.includes("\f")) {
        return normalized
            .split("\f")
            .map(pdfTextAdapter_1.normalizeExtractedPageText)
            .filter(Boolean);
    }
    return null;
}
function groupPhysicalChunksByInvoiceNumber(chunks) {
    const documents = [];
    let currentDoc = "";
    let currentInvoiceNumber = "";
    for (const chunk of chunks) {
        const invoiceNumber = extractHeaderInvoiceNumber(chunk);
        if (!currentDoc) {
            currentDoc = chunk;
            currentInvoiceNumber = invoiceNumber;
            continue;
        }
        if (!invoiceNumber || invoiceNumber === currentInvoiceNumber) {
            currentDoc = `${currentDoc}\n\n${chunk}`;
            if (invoiceNumber)
                currentInvoiceNumber = invoiceNumber;
            continue;
        }
        documents.push(currentDoc);
        currentDoc = chunk;
        currentInvoiceNumber = invoiceNumber;
    }
    if (currentDoc)
        documents.push(currentDoc);
    return documents.map(pdfTextAdapter_1.normalizeExtractedPageText).filter(Boolean);
}
function findHeaderAnchoredInvoiceStarts(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const starts = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        for (const pattern of INVOICE_NUMBER_LABEL_PATTERNS) {
            const match = line.match(pattern);
            if (match && isPlausibleInvoiceNumber(match[1])) {
                starts.push({ lineIndex, invoiceNumber: match[1].trim() });
                break;
            }
        }
    }
    return starts;
}
function lineIndexToCharIndex(lines, lineIndex) {
    let index = 0;
    for (let i = 0; i < lineIndex; i += 1) {
        index += lines[i].length + 1;
    }
    return index;
}
function documentStartLineIndex(lines, invoiceLineIndex) {
    let start = invoiceLineIndex;
    for (let j = invoiceLineIndex - 1; j >= 0 && invoiceLineIndex - j <= MAX_VENDOR_HEADER_LOOKBACK; j -= 1) {
        if (lines[j].trim() === "")
            break;
        start = j;
    }
    return start;
}
function splitOnHeaderAnchoredInvoiceStarts(text) {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const headerStarts = findHeaderAnchoredInvoiceStarts(normalized);
    const seen = new Set();
    const distinctStarts = [];
    for (const start of headerStarts) {
        if (seen.has(start.invoiceNumber))
            continue;
        seen.add(start.invoiceNumber);
        distinctStarts.push(start);
    }
    if (distinctStarts.length < 2)
        return null;
    const splitLineIndices = distinctStarts.slice(1).map((start) => documentStartLineIndex(lines, start.lineIndex));
    const charIndices = [0, ...splitLineIndices.map((lineIdx) => lineIndexToCharIndex(lines, lineIdx))];
    const documents = [];
    for (let i = 0; i < charIndices.length; i += 1) {
        const slice = normalized.slice(charIndices[i], charIndices[i + 1] ?? normalized.length);
        const trimmed = (0, pdfTextAdapter_1.normalizeExtractedPageText)(slice);
        if (trimmed)
            documents.push(trimmed);
    }
    return documents.length >= 2 ? documents : null;
}
/** Split extracted PDF text into one string per logical vendor invoice document. */
function splitExtractedTextIntoInvoiceDocuments(text, hints) {
    const normalized = text.replace(/\r\n/g, "\n");
    const route = (0, vendorInvoiceRouter_1.routeInvoiceFormat)(normalized, hints);
    if (route.formatId === "first_supply" || /First Supply LLC/i.test(normalized)) {
        const blocks = splitFirstSupplyInvoiceBlocks(normalized);
        if (blocks.length > 0) {
            // Same Invoice # across pages = one logical document (mixed with 1-page invoices OK).
            return capInvoiceDocuments(groupPhysicalChunksByInvoiceNumber(blocks));
        }
    }
    const physicalChunks = splitOnPhysicalBoundaries(normalized);
    if (physicalChunks && physicalChunks.length > 0) {
        return capInvoiceDocuments(groupPhysicalChunksByInvoiceNumber(physicalChunks));
    }
    const headerSplit = splitOnHeaderAnchoredInvoiceStarts(normalized);
    if (headerSplit)
        return capInvoiceDocuments(headerSplit);
    const trimmed = (0, pdfTextAdapter_1.normalizeExtractedPageText)(normalized);
    return trimmed ? [trimmed] : [];
}
function preferredPreParseFormat(text, hints) {
    return (0, vendorInvoiceRouter_1.routeInvoiceFormat)(text, hints).formatId;
}
//# sourceMappingURL=invoiceDocumentSplit.js.map