/**
 * Server-side PDF text extraction for inbound invoice attachments.
 */
import pdfParse = require("pdf-parse");
import {
  hasCustomFontPdfEncoding,
  postProcessExtractedPdfText,
} from "./normalizePdfText";

export interface PdfExtractResult {
  text: string;
  rawText?: string;
  pageCount: number;
  extractor: "pdfjs" | "pdf-parse";
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 50;

interface TextItem {
  str?: string;
  transform?: number[];
}

async function loadPdfJs() {
  const dynamicImport = new Function("p", "return import(p)") as (
    specifier: string,
  ) => Promise<{ getDocument: typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument }>;
  return dynamicImport("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Group pdf.js text items into lines by Y transform coordinate. */
function itemsToLineText(items: TextItem[]): string {
  const rows: Array<{ y: number; x: number; str: string }> = [];
  for (const item of items) {
    const str = item.str?.trim();
    if (!str) continue;
    const transform = item.transform ?? [0, 0, 0, 0, 0, 0];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    rows.push({ y, x, str });
  }
  rows.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 2) return dy;
    return a.x - b.x;
  });

  const lines: string[] = [];
  let currentY: number | null = null;
  let parts: string[] = [];

  for (const row of rows) {
    if (currentY === null || Math.abs(row.y - currentY) > 2) {
      if (parts.length > 0) lines.push(parts.join(" "));
      parts = [row.str];
      currentY = row.y;
    } else {
      parts.push(row.str);
    }
  }
  if (parts.length > 0) lines.push(parts.join(" "));
  return lines.join("\n");
}

async function extractWithPdfJs(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(buffer);
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const pageCount = doc.numPages;
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`pdf exceeds max page count (${MAX_PDF_PAGES})`);
  }
  const pageTexts: string[] = [];
  for (let i = 1; i <= pageCount; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(itemsToLineText(content.items as TextItem[]));
  }
  return { text: pageTexts.join("\n\f\n"), pageCount };
}

async function extractWithPdfParse(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const parsed = await pdfParse(buffer);
  const text = (parsed.text ?? "").trim();
  const pageCount = parsed.numpages ?? 1;
  return { text, pageCount };
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  if (buffer.length === 0) {
    throw new Error("empty pdf buffer");
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(`pdf exceeds max size (${MAX_PDF_BYTES} bytes)`);
  }

  let rawText: string;
  let pageCount: number;
  let extractor: PdfExtractResult["extractor"] = "pdfjs";

  try {
    const pdfJs = await extractWithPdfJs(buffer);
    rawText = pdfJs.text;
    pageCount = pdfJs.pageCount;
  } catch {
    const pdfParseResult = await extractWithPdfParse(buffer);
    rawText = pdfParseResult.text;
    pageCount = pdfParseResult.pageCount;
    extractor = "pdf-parse";
  }

  if (!rawText.trim()) {
    throw new Error("pdf produced no extractable text");
  }

  if (extractor === "pdf-parse" && hasCustomFontPdfEncoding(rawText)) {
    try {
      const pdfJs = await extractWithPdfJs(buffer);
      rawText = pdfJs.text;
      pageCount = pdfJs.pageCount;
      extractor = "pdfjs";
    } catch {
      // keep pdf-parse raw; postProcess will normalize U+XX00
    }
  }

  const text = postProcessExtractedPdfText(rawText).trim();
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
