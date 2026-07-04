"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExpectedItemsFromImport = buildExpectedItemsFromImport;
/** Build expected line items from sanitized invoice lines — no qtyReceived/staging. */
function buildExpectedItemsFromImport(importId, deliveryOrderId, jobId, lines) {
    return lines
        .filter((line) => !line.excludeFromExpectedItems && line.lineType === "product")
        .map((line) => ({
        id: `item-vii-${importId}-ln-${line.lineNumber}`,
        deliveryOrderId,
        jobId,
        sku: line.vendorProductNumber,
        description: line.description,
        qtyOrdered: line.quantityOrdered,
        qtyReceived: 0,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered: line.quantityBackordered,
        status: "pending",
    }));
}
//# sourceMappingURL=buildExpectedItemsFromImport.js.map