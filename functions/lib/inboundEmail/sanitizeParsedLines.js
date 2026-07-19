"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PARSED_LINES_PER_IMPORT = void 0;
exports.sanitizeParsedLines = sanitizeParsedLines;
const MAX_DESCRIPTION_LEN = 2048;
const MAX_PRODUCT_NUMBER_LEN = 128;
const MAX_NOTE_LEN = 512;
const MAX_NOTES_PER_LINE = 20;
/** Align with approveVendorInvoiceImport expected-items guard — blocks inbound amplification. */
exports.MAX_PARSED_LINES_PER_IMPORT = 200;
/** Persist only Table B fields — no raw PDF text or extra parser internals. */
function sanitizeParsedLines(lines) {
    return lines.slice(0, exports.MAX_PARSED_LINES_PER_IMPORT).map((line) => ({
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
//# sourceMappingURL=sanitizeParsedLines.js.map