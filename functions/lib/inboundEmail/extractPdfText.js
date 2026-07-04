"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextFromPdfBuffer = extractTextFromPdfBuffer;
/**
 * Server-side PDF text extraction for inbound invoice attachments.
 */
const pdfParse = require("pdf-parse");
const normalizePdfText_1 = require("./normalizePdfText");
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 50;
async function loadPdfJs() {
    const dynamicImport = new Function("p", "return import(p)");
    return dynamicImport("pdfjs-dist/legacy/build/pdf.mjs");
}
/** Group pdf.js text items into lines by Y transform coordinate. */
function itemsToLineText(items) {
    const rows = [];
    for (const item of items) {
        const str = item.str?.trim();
        if (!str)
            continue;
        const transform = item.transform ?? [0, 0, 0, 0, 0, 0];
        const x = transform[4] ?? 0;
        const y = transform[5] ?? 0;
        rows.push({ y, x, str });
    }
    rows.sort((a, b) => {
        const dy = b.y - a.y;
        if (Math.abs(dy) > 2)
            return dy;
        return a.x - b.x;
    });
    const lines = [];
    let currentY = null;
    let parts = [];
    for (const row of rows) {
        if (currentY === null || Math.abs(row.y - currentY) > 2) {
            if (parts.length > 0)
                lines.push(parts.join(" "));
            parts = [row.str];
            currentY = row.y;
        }
        else {
            parts.push(row.str);
        }
    }
    if (parts.length > 0)
        lines.push(parts.join(" "));
    return lines.join("\n");
}
async function extractWithPdfJs(buffer) {
    const { getDocument } = await loadPdfJs();
    const data = new Uint8Array(buffer);
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    const pageCount = doc.numPages;
    if (pageCount > MAX_PDF_PAGES) {
        throw new Error(`pdf exceeds max page count (${MAX_PDF_PAGES})`);
    }
    const pageTexts = [];
    for (let i = 1; i <= pageCount; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pageTexts.push(itemsToLineText(content.items));
    }
    return { text: pageTexts.join("\n\f\n"), pageCount };
}
async function extractWithPdfParse(buffer) {
    const parsed = await pdfParse(buffer);
    const text = (parsed.text ?? "").trim();
    const pageCount = parsed.numpages ?? 1;
    return { text, pageCount };
}
async function extractTextFromPdfBuffer(buffer) {
    if (buffer.length === 0) {
        throw new Error("empty pdf buffer");
    }
    if (buffer.length > MAX_PDF_BYTES) {
        throw new Error(`pdf exceeds max size (${MAX_PDF_BYTES} bytes)`);
    }
    let rawText = "";
    let pageCount = 1;
    let extractor = "pdfjs";
    try {
        const pdfJs = await extractWithPdfJs(buffer);
        rawText = pdfJs.text;
        pageCount = pdfJs.pageCount;
    }
    catch {
        const pdfParseResult = await extractWithPdfParse(buffer);
        rawText = pdfParseResult.text;
        pageCount = pdfParseResult.pageCount;
        extractor = "pdf-parse";
    }
    if (!rawText.trim()) {
        throw new Error("pdf produced no extractable text");
    }
    if (extractor === "pdf-parse" && (0, normalizePdfText_1.hasCustomFontPdfEncoding)(rawText)) {
        try {
            const pdfJs = await extractWithPdfJs(buffer);
            rawText = pdfJs.text;
            pageCount = pdfJs.pageCount;
            extractor = "pdfjs";
        }
        catch {
            // keep pdf-parse raw; postProcess will normalize U+XX00
        }
    }
    const text = (0, normalizePdfText_1.postProcessExtractedPdfText)(rawText).trim();
    if (!text) {
        throw new Error("pdf produced no extractable text after normalization");
    }
    return {
        text,
        rawText: rawText !== text ? rawText : undefined,
        pageCount,
        extractor,
    };
}
//# sourceMappingURL=extractPdfText.js.map