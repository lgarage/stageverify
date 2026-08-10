"use strict";
/**
 * D-90 Slice 1 — pure item-quantity truth for exception-oriented vendor Delivered.
 * Invariant: qtyReceived + qtyBackordered + qtyMissing + qtyDamaged === qtyOrdered
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorDeliveredItemTruthError = void 0;
exports.computeVendorDeliveredItemStatus = computeVendorDeliveredItemStatus;
exports.computeCompleteAllItemTruth = computeCompleteAllItemTruth;
exports.computeExceptionItemTruth = computeExceptionItemTruth;
exports.parseLineExceptions = parseLineExceptions;
exports.itemTruthChanged = itemTruthChanged;
class VendorDeliveredItemTruthError extends Error {
    code;
    constructor(message) {
        super(message);
        this.name = "VendorDeliveredItemTruthError";
        this.code = "invalid-argument";
    }
}
exports.VendorDeliveredItemTruthError = VendorDeliveredItemTruthError;
function asNonNegInt(value, label) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 9999) {
        throw new VendorDeliveredItemTruthError(`Invalid ${label}.`);
    }
    return value;
}
function computeVendorDeliveredItemStatus(truth) {
    if (truth.qtyBackordered > 0 && truth.qtyReceived === 0 && truth.qtyDamaged === 0) {
        return "backordered";
    }
    if (truth.qtyReceived === truth.qtyOrdered)
        return "received";
    if (truth.qtyReceived > 0)
        return "partial";
    if (truth.qtyDamaged > 0)
        return "damaged";
    if (truth.qtyMissing > 0)
        return "missing";
    if (truth.qtyBackordered > 0)
        return "backordered";
    return "pending";
}
/** Complete-all: preserve prior explicit BO; never invent BO from shortfall. */
function computeCompleteAllItemTruth(prior) {
    const qtyOrdered = asNonNegInt(prior.qtyOrdered, "qtyOrdered");
    const priorBO = Math.max(0, Math.floor(Number(prior.qtyBackordered ?? 0)));
    const qtyBackordered = Math.min(priorBO, qtyOrdered);
    const qtyReceived = qtyOrdered - qtyBackordered;
    const truth = {
        qtyOrdered,
        qtyReceived,
        qtyMissing: 0,
        qtyDamaged: 0,
        qtyBackordered,
        status: "pending",
    };
    truth.status = computeVendorDeliveredItemStatus(truth);
    return truth;
}
/** Exception line: server derives qtyMissing; no double-count. */
function computeExceptionItemTruth(qtyOrderedRaw, exception) {
    const qtyOrdered = asNonNegInt(qtyOrderedRaw, "qtyOrdered");
    const qtyReceived = asNonNegInt(exception.qtyReceived, "qtyReceived");
    const qtyBackordered = asNonNegInt(exception.qtyBackordered, "qtyBackordered");
    const qtyDamaged = asNonNegInt(exception.qtyDamaged, "qtyDamaged");
    const accounted = qtyReceived + qtyBackordered + qtyDamaged;
    if (accounted > qtyOrdered) {
        throw new VendorDeliveredItemTruthError("Received + backordered + damaged exceeds ordered quantity.");
    }
    const qtyMissing = qtyOrdered - accounted;
    const truth = {
        qtyOrdered,
        qtyReceived,
        qtyMissing,
        qtyDamaged,
        qtyBackordered,
        status: "pending",
    };
    truth.status = computeVendorDeliveredItemStatus(truth);
    return truth;
}
function parseLineExceptions(value) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value) || value.length > 500)
        return null;
    const out = [];
    const seen = new Set();
    for (const entry of value) {
        if (!entry || typeof entry !== "object")
            return null;
        const row = entry;
        if (typeof row.itemId !== "string" || !row.itemId.trim())
            return null;
        const itemId = row.itemId.trim();
        if (seen.has(itemId))
            return null;
        // All three qty fields required together (reject partial objects).
        if (!("qtyReceived" in row) ||
            !("qtyBackordered" in row) ||
            !("qtyDamaged" in row)) {
            return null;
        }
        try {
            out.push({
                itemId,
                qtyReceived: asNonNegInt(row.qtyReceived, "qtyReceived"),
                qtyBackordered: asNonNegInt(row.qtyBackordered, "qtyBackordered"),
                qtyDamaged: asNonNegInt(row.qtyDamaged, "qtyDamaged"),
            });
        }
        catch {
            return null;
        }
        seen.add(itemId);
    }
    return out;
}
function itemTruthChanged(prior, next) {
    return (Number(prior.qtyReceived ?? 0) !== next.qtyReceived ||
        Number(prior.qtyMissing ?? 0) !== next.qtyMissing ||
        Number(prior.qtyDamaged ?? 0) !== next.qtyDamaged ||
        Number(prior.qtyBackordered ?? 0) !== next.qtyBackordered ||
        String(prior.status ?? "") !== next.status);
}
//# sourceMappingURL=vendorDeliveredItemTruth.js.map