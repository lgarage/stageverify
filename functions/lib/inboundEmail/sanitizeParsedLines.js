"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeParsedLines = sanitizeParsedLines;
const MAX_DESCRIPTION_LEN = 2048;
const MAX_PRODUCT_NUMBER_LEN = 128;
const MAX_NOTE_LEN = 512;
const MAX_NOTES_PER_LINE = 20;
/** Persist only Table B fields — no raw PDF text or extra parser internals. */
function sanitizeParsedLines(lines) {
    return lines.map((line) => ({
        lineNumber: line.lineNumber,
        quantityOrdered: line.quantityOrdered,
        quantityShipped: line.quantityShipped,
        quantityBackordered: line.quantityBackordered,
        vendorProductNumber: line.vendorProductNumber.slice(0, MAX_PRODUCT_NUMBER_LEN),
        manufacturerOrModelNumber: line.manufacturerOrModelNumber?.slice(0, MAX_PRODUCT_NUMBER_LEN),
        description: line.description.slice(0, MAX_DESCRIPTION_LEN),
        filteredNotes: line.filteredNotes
            .slice(0, MAX_NOTES_PER_LINE)
            .map((n) => n.slice(0, MAX_NOTE_LEN)),
        lineType: line.lineType,
        excludeFromExpectedItems: line.excludeFromExpectedItems,
    }));
}
//# sourceMappingURL=sanitizeParsedLines.js.map