/**
 * Server-side PDF text extraction for inbound invoice attachments.
 */
import pdfParse = require("pdf-parse");

export interface PdfExtractResult {
  text: string;
  pageCount: number;
}

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_PAGES = 50;

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  if (buffer.length === 0) {
    throw new Error("empty pdf buffer");
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(`pdf exceeds max size (${MAX_PDF_BYTES} bytes)`);
  }
  const parsed = await pdfParse(buffer);
  const text = (parsed.text ?? "").trim();
  if (!text) {
    throw new Error("pdf produced no extractable text");
  }
  const pageCount = parsed.numpages ?? 1;
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`pdf exceeds max page count (${MAX_PDF_PAGES})`);
  }
  return { text, pageCount };
}
