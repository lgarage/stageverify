"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUnplannedReference = normalizeUnplannedReference;
exports.asUnplannedReference = asUnplannedReference;
exports.filterMatchContextToVendor = filterMatchContextToVendor;
exports.scoreExactVendorFieldMatches = scoreExactVendorFieldMatches;
exports.classifyUnplannedVendorMatch = classifyUnplannedVendorMatch;
exports.unplannedDeliveryDocId = unplannedDeliveryDocId;
/**
 * Vendor unplanned-delivery match classification — pure logic + thin adapter
 * over matchInvoiceToRecords (vendor-scoped context only).
 */
const crypto_1 = require("crypto");
const matchInvoiceToRecords_1 = require("./invoice/matchInvoiceToRecords");
function normalizeUnplannedReference(reference) {
    return reference.trim().toUpperCase();
}
function asUnplannedReference(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 64)
        return null;
    return trimmed;
}
/** Filter match context to a single vendor — hard invariant. */
function filterMatchContextToVendor(ctx, vendorId) {
    return {
        vendors: ctx.vendors.filter((v) => v.id === vendorId),
        jobs: ctx.jobs,
        purchaseOrders: ctx.purchaseOrders.filter((po) => po.vendorId === vendorId),
        deliveries: ctx.deliveries.filter((d) => d.vendorId === vendorId),
    };
}
/**
 * Exact-field boosts for vendorInvoiceNumber / orderNumber on vendor deliveries.
 * Used alongside matchInvoiceToRecords — never cross-vendor.
 */
function scoreExactVendorFieldMatches(reference, vendorDeliveries, jobNameById, poNumberById) {
    const key = normalizeUnplannedReference(reference);
    if (!key)
        return [];
    const out = [];
    for (const d of vendorDeliveries) {
        const order = String(d.orderNumber ?? "").trim().toUpperCase();
        const invoice = String(d.vendorInvoiceNumber ?? "").trim().toUpperCase();
        let score = 0;
        if (invoice && invoice === key)
            score = Math.max(score, 90);
        if (order && order === key)
            score = Math.max(score, 90);
        if (score === 0)
            continue;
        const jobId = String(d.jobId ?? "");
        out.push({
            deliveryId: d.id,
            orderNumber: String(d.orderNumber ?? d.id),
            jobId,
            jobName: jobNameById.get(jobId),
            poNumber: d.purchaseOrderId
                ? poNumberById.get(d.purchaseOrderId)
                : undefined,
            vendorInvoiceNumber: d.vendorInvoiceNumber,
            confidenceScore: score,
        });
    }
    return out.sort((a, b) => b.confidenceScore - a.confidenceScore);
}
function toCandidateSummary(c, jobNameById, poNumberById, invoiceByDeliveryId) {
    return {
        deliveryId: c.deliveryId,
        orderNumber: c.orderNumber,
        jobId: c.jobId,
        jobName: jobNameById.get(c.jobId),
        poNumber: c.purchaseOrderId
            ? poNumberById.get(c.purchaseOrderId)
            : undefined,
        vendorInvoiceNumber: invoiceByDeliveryId.get(c.deliveryId),
        confidenceScore: c.confidenceScore,
    };
}
/**
 * Classify unplanned reference against vendor-scoped records.
 * Strong match requires a single candidate at ≥ INVOICE_AUTO_APPLY_CONFIDENCE (85).
 * Never auto-links — caller must confirm.
 */
function classifyUnplannedVendorMatch(input) {
    const exact = scoreExactVendorFieldMatches(input.reference, input.vendorDeliveries, input.jobNameById, input.poNumberById);
    // Do not set both vendorOrderNumber and vendorInvoiceNumber to the same
    // string — matchInvoiceToRecords would double-count the same key.
    const header = {
        customerAccountNumber: "",
        vendorOrderNumber: input.reference.trim(),
        vendorInvoiceNumber: "",
        customerPoOrReference: input.reference.trim(),
        orderDate: "",
        invoiceDate: "",
        shipDate: "",
        jobNumberRaw: "",
        vendorBranchName: "",
        vendorBranchAddress: "",
        vendorBranchPhone: "",
        soldToName: "",
        shipToName: "",
        shipToAddress: "",
        fulfillmentMethod: "unknown",
        shipCompletePolicy: "unknown",
    };
    const match = (0, matchInvoiceToRecords_1.matchInvoiceToRecords)(`unplanned-${normalizeUnplannedReference(input.reference)}`, header, input.vendorScopedCtx);
    const invoiceByDeliveryId = new Map(input.vendorDeliveries.map((d) => [
        d.id,
        typeof d.vendorInvoiceNumber === "string" ? d.vendorInvoiceNumber : "",
    ]));
    const fromMatcher = match.candidates.map((c) => toCandidateSummary(c, input.jobNameById, input.poNumberById, invoiceByDeliveryId));
    // Merge exact + matcher by deliveryId, keep max score.
    const merged = new Map();
    for (const c of [...exact, ...fromMatcher]) {
        const prev = merged.get(c.deliveryId);
        if (!prev || c.confidenceScore > prev.confidenceScore) {
            merged.set(c.deliveryId, c);
        }
    }
    const candidates = [...merged.values()].sort((a, b) => b.confidenceScore - a.confidenceScore);
    if (candidates.length === 1 &&
        candidates[0].confidenceScore >= matchInvoiceToRecords_1.INVOICE_AUTO_APPLY_CONFIDENCE) {
        return {
            outcome: "strong_match",
            candidate: candidates[0],
            candidateSummaries: [candidates[0]],
        };
    }
    if (candidates.length === 0) {
        return { outcome: "no_match", candidateSummaries: [] };
    }
    return {
        outcome: "ambiguous",
        candidateSummaries: candidates.slice(0, 3),
    };
}
function unplannedDeliveryDocId(vendorId, reference) {
    const norm = normalizeUnplannedReference(reference);
    const hash = (0, crypto_1.createHash)("sha256")
        .update(`${vendorId}:${norm}`)
        .digest("hex")
        .slice(0, 20);
    return `unplanned-${hash}`;
}
//# sourceMappingURL=unplannedVendorDeliveryMatching.js.map