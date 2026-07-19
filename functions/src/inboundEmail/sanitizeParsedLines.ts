import type { ParsedInvoiceLine } from "../invoice/types";
import type { VendorInvoiceImportParsedLine } from "./types";

const MAX_DESCRIPTION_LEN = 2048;
const MAX_PRODUCT_NUMBER_LEN = 128;
const MAX_NOTE_LEN = 512;
const MAX_NOTES_PER_LINE = 20;
/** Align with approveVendorInvoiceImport expected-items guard — blocks inbound amplification. */
export const MAX_PARSED_LINES_PER_IMPORT = 200;

/** Persist only Table B fields — no raw PDF text or extra parser internals. */
export function sanitizeParsedLines(lines: ParsedInvoiceLine[]): VendorInvoiceImportParsedLine[] {
  return lines.slice(0, MAX_PARSED_LINES_PER_IMPORT).map((line) => ({
    lineNumber: line.lineNumber,
    quantityOrdered: line.quantityOrdered,
    quantityShipped: line.quantityShipped,
    quantityBackordered: line.quantityBackordered,
    vendorProductNumber: line.vendorProductNumber.slice(0, MAX_PRODUCT_NUMBER_LEN),
    manufacturerOrModelNumber: line.manufacturerOrModelNumber?.slice(0, MAX_PRODUCT_NUMBER_LEN),
    description: line.description.slice(0, MAX_DESCRIPTION_LEN),
    unitOfMeasure: line.unitOfMeasure?.slice(0, 16),
    lineExtension: line.lineExtension?.slice(0, 32),
    filteredNotes: line.filteredNotes
      .slice(0, MAX_NOTES_PER_LINE)
      .map((n) => n.slice(0, MAX_NOTE_LEN)),
    lineType: line.lineType,
    excludeFromExpectedItems: line.excludeFromExpectedItems,
  }));
}
