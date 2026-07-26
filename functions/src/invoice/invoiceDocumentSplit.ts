import { INVOICE_PAGE_BOUNDARY, normalizeExtractedPageText } from "./pdfTextAdapter";
import { routeInvoiceFormat, type InvoiceRouteHints } from "./vendorInvoiceRouter";
import type { VendorInvoiceParserFormatId } from "./types";

/** Inbound email joins multiple PDF extracts with this marker (see processInboundGmailMessage). */
export const PDF_ATTACHMENT_BOUNDARY = "\n\n---PDF ATTACHMENT---\n\n";
export const PDF_ATTACHMENT_MARKER = "---PDF ATTACHMENT---";

const HEADER_WINDOW_LINES = 25;
/** Tabular Johnstone headers can sit below stacked label blocks — scan until line grid. */
const TABULAR_HEADER_MAX_LINES = 45;

function tabularHeaderScanEnd(lines: string[]): number {
  for (let i = 0; i < lines.length && i < TABULAR_HEADER_MAX_LINES; i += 1) {
    if (/^LN\s+QNTY/i.test(lines[i]!.trim())) {
      return Math.max(0, i - 1);
    }
  }
  return Math.min(lines.length - 1, TABULAR_HEADER_MAX_LINES);
}
const MAX_VENDOR_HEADER_LOOKBACK = 15;
/** Cap logical invoices per extract — blocks review-queue amplification from crafted PDF text. */
export const MAX_INVOICE_DOCUMENTS_PER_EXTRACT = 20;

function capInvoiceDocuments(documents: string[]): string[] {
  if (documents.length <= MAX_INVOICE_DOCUMENTS_PER_EXTRACT) return documents;
  return documents.slice(0, MAX_INVOICE_DOCUMENTS_PER_EXTRACT);
}

const INVOICE_NUMBER_LABEL_PATTERNS = [
  /^\s*Invoice\s*#\s*:?\s*(.+)$/i,
  /^\s*Invoice\s+Number\s*:?\s*(.+)$/i,
  /^\s*Invoice\s+No\.?\s*:?\s*(.+)$/i,
] as const;

function splitFirstSupplyInvoiceBlocks(text: string): string[] {
  const parts = text
    .split(/\n(?=Invoice\n)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => (part.startsWith("Invoice") ? part : `Invoice\n${part}`));
}

export function isPlausibleInvoiceNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!/\d/.test(trimmed)) return false;
  if (/^(date|number|invoice|no\.?)$/i.test(trimmed)) return false;
  return true;
}

/** Johnstone tabular header: label row + value row (mirrors parseTabularHeaderBlock). */
function extractJohnstoneTabularHeaderInvoiceNumber(lines: string[]): string {
  const windowEnd = tabularHeaderScanEnd(lines);
  for (let i = 0; i < windowEnd; i += 1) {
    const labelLine = lines[i]!.trim();
    const valueLine = lines[i + 1]!.trim();
    if (!/^Invoice\s*#\s+Invoice\s+Date/i.test(labelLine) || !valueLine) continue;
    const firstToken = valueLine.split(/\s+/).find(Boolean) ?? "";
    if (isPlausibleInvoiceNumber(firstToken)) {
      return firstToken;
    }
  }
  return "";
}

/** Extract invoice # from the header window only — label-anchored, not mid-body references. */
export function extractHeaderInvoiceNumber(text: string): string {
  const allLines = text.replace(/\r\n/g, "\n").split("\n");
  const lines = allLines.slice(0, HEADER_WINDOW_LINES);

  const tabular = extractJohnstoneTabularHeaderInvoiceNumber(allLines);
  if (tabular) return tabular;

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

function splitOnPhysicalBoundaries(text: string): string[] | null {
  const normalized = text.replace(/\r\n/g, "\n");

  if (
    normalized.includes(PDF_ATTACHMENT_BOUNDARY) ||
    normalized.includes(PDF_ATTACHMENT_MARKER)
  ) {
    return normalized
      .split(/\n\n---PDF ATTACHMENT---\n\n|---PDF ATTACHMENT---/)
      .map(normalizeExtractedPageText)
      .filter(Boolean);
  }

  if (normalized.includes(INVOICE_PAGE_BOUNDARY)) {
    return normalized
      .split(INVOICE_PAGE_BOUNDARY)
      .map(normalizeExtractedPageText)
      .filter(Boolean);
  }

  if (normalized.includes("\f")) {
    return normalized
      .split("\f")
      .map(normalizeExtractedPageText)
      .filter(Boolean);
  }

  return null;
}

function groupPhysicalChunksByInvoiceNumber(chunks: string[]): string[] {
  const documents: string[] = [];
  let currentDoc = "";
  let currentInvoiceNumber = "";

  for (const chunk of chunks) {
    const invoiceNumber = extractHeaderInvoiceNumber(chunk);

    if (!currentDoc) {
      currentDoc = chunk;
      currentInvoiceNumber = invoiceNumber;
      continue;
    }

    const continuationOfNumberedDoc = Boolean(currentInvoiceNumber && !invoiceNumber);
    const sameInvoiceNumber = Boolean(invoiceNumber && invoiceNumber === currentInvoiceNumber);

    if (continuationOfNumberedDoc || sameInvoiceNumber) {
      currentDoc = `${currentDoc}\n\n${chunk}`;
      if (invoiceNumber) currentInvoiceNumber = invoiceNumber;
      continue;
    }

    if (!currentInvoiceNumber && !invoiceNumber) {
      documents.push(currentDoc);
      currentDoc = chunk;
      currentInvoiceNumber = invoiceNumber;
      continue;
    }

    documents.push(currentDoc);
    currentDoc = chunk;
    currentInvoiceNumber = invoiceNumber;
  }

  if (currentDoc) documents.push(currentDoc);
  return documents.map(normalizeExtractedPageText).filter(Boolean);
}

type InvoiceDocumentStart = { lineIndex: number; invoiceNumber: string };

function findHeaderAnchoredInvoiceStarts(text: string): InvoiceDocumentStart[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const starts: InvoiceDocumentStart[] = [];

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

  for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex += 1) {
    const labelLine = lines[lineIndex]!.trim();
    const valueLine = lines[lineIndex + 1]!.trim();
    if (!/^Invoice\s*#\s+Invoice\s+Date/i.test(labelLine) || !valueLine) continue;
    const firstToken = valueLine.split(/\s+/).find(Boolean) ?? "";
    if (isPlausibleInvoiceNumber(firstToken)) {
      starts.push({ lineIndex: lineIndex + 1, invoiceNumber: firstToken });
    }
  }

  return starts;
}

function lineIndexToCharIndex(lines: string[], lineIndex: number): number {
  let index = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    index += lines[i].length + 1;
  }
  return index;
}

function documentStartLineIndex(lines: string[], invoiceLineIndex: number): number {
  let start = invoiceLineIndex;
  for (
    let j = invoiceLineIndex - 1;
    j >= 0 && invoiceLineIndex - j <= MAX_VENDOR_HEADER_LOOKBACK;
    j -= 1
  ) {
    if (lines[j].trim() === "") break;
    start = j;
  }
  return start;
}

function splitOnHeaderAnchoredInvoiceStarts(text: string): string[] | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const headerStarts = findHeaderAnchoredInvoiceStarts(normalized);

  const seen = new Set<string>();
  const distinctStarts: InvoiceDocumentStart[] = [];
  for (const start of headerStarts) {
    if (seen.has(start.invoiceNumber)) continue;
    seen.add(start.invoiceNumber);
    distinctStarts.push(start);
  }

  if (distinctStarts.length < 2) return null;

  const splitLineIndices = distinctStarts.slice(1).map((start) =>
    documentStartLineIndex(lines, start.lineIndex),
  );
  const charIndices = [0, ...splitLineIndices.map((lineIdx) => lineIndexToCharIndex(lines, lineIdx))];

  const documents: string[] = [];
  for (let i = 0; i < charIndices.length; i += 1) {
    const slice = normalized.slice(charIndices[i], charIndices[i + 1] ?? normalized.length);
    const trimmed = normalizeExtractedPageText(slice);
    if (trimmed) documents.push(trimmed);
  }

  return documents.length >= 2 ? documents : null;
}

/** Split extracted PDF text into one string per logical vendor invoice document. */
export function splitExtractedTextIntoInvoiceDocuments(
  text: string,
  hints?: InvoiceRouteHints,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const route = routeInvoiceFormat(normalized, hints);

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
  if (headerSplit) return capInvoiceDocuments(headerSplit);

  const trimmed = normalizeExtractedPageText(normalized);
  return trimmed ? [trimmed] : [];
}

export function preferredPreParseFormat(
  text: string,
  hints?: InvoiceRouteHints,
): VendorInvoiceParserFormatId {
  return routeInvoiceFormat(text, hints).formatId;
}
