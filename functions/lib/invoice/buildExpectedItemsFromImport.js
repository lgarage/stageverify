"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExpectedItemsFromImport = buildExpectedItemsFromImport;
exports.itemWritePreservingReceiveProgress = itemWritePreservingReceiveProgress;
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
const RECEIVE_PROGRESS_FIELDS = [
    "qtyReceived",
    "qtyMissing",
    "qtyDamaged",
    "status",
];
/**
 * Resend line refresh must not zero receive or pickup progress already on the line.
 * New lines still start at qtyReceived 0.
 */
function itemWritePreservingReceiveProgress(item, existing) {
    if (!existing)
        return { ...item };
    const write = { ...item };
    for (const field of RECEIVE_PROGRESS_FIELDS) {
        if (existing[field] !== undefined) {
            delete write[field];
        }
    }
    return write;
}
//# sourceMappingURL=buildExpectedItemsFromImport.js.map