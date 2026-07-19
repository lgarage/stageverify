import { INVOICE_PAGE_BOUNDARY, normalizeExtractedPageText } from "./pdfTextAdapter";
import { routeInvoiceFormat, type InvoiceRouteHints } from "./vendorInvoiceRouter";
import type { VendorInvoiceParserFormatId } from "./types";

function splitFirstSupplyInvoiceBlocks(text: string): string[] {
  const parts = text
    .split(/\n(?=Invoice\n)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => (part.startsWith("Invoice") ? part : `Invoice\n${part}`));
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
    if (blocks.length > 0) return blocks;
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
  const trimmed = normalizeExtractedPageText(normalized);
  return trimmed ? [trimmed] : [];
}

export function preferredPreParseFormat(
  text: string,
  hints?: InvoiceRouteHints,
): VendorInvoiceParserFormatId {
  return routeInvoiceFormat(text, hints).formatId;
}
