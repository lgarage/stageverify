"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchEmailToRecords = matchEmailToRecords;
exports.shouldAutoApplyVendorOrderComplete = shouldAutoApplyVendorOrderComplete;
const types_1 = require("./types");
function vendorFromSender(senderEmail, vendors, domains) {
    const domain = senderEmail.split("@")[1]?.toLowerCase();
    if (!domain)
        return { score: 0, reason: "no_sender_domain" };
    const byDomain = vendors.find((v) => {
        const mapped = domains?.get(v.id);
        if (mapped && mapped.toLowerCase() === domain)
            return true;
        const contact = v.email?.split("@")[1]?.toLowerCase();
        return contact === domain;
    });
    if (byDomain) {
        return { vendor: byDomain, score: 25, reason: "sender_domain_match" };
    }
    return { score: 0, reason: "unknown_sender_domain" };
}
function matchEmailToRecords(message, parsed, ctx) {
    let score = 0;
    const reasons = [];
    let vendorId;
    let jobId;
    let purchaseOrderId;
    let deliveryOrderId;
    const senderMatch = vendorFromSender(message.senderEmail, ctx.vendors, ctx.vendorEmailDomains);
    if (senderMatch.vendor) {
        vendorId = senderMatch.vendor.id;
        score += senderMatch.score;
        reasons.push(senderMatch.reason);
    }
    else {
        reasons.push(senderMatch.reason);
    }
    const poNumber = parsed.poNumbers[0];
    const orderNumber = parsed.orderNumbers[0];
    const jobNumber = parsed.jobNumbers[0];
    let poMatches = ctx.purchaseOrders;
    if (poNumber) {
        const exactPo = ctx.purchaseOrders.filter((po) => po.poNumber.toUpperCase() === poNumber.toUpperCase());
        if (exactPo.length === 1) {
            purchaseOrderId = exactPo[0].id;
            jobId = exactPo[0].jobId;
            vendorId = vendorId ?? exactPo[0].vendorId;
            score += 40;
            reasons.push("exact_po_number");
            poMatches = exactPo;
        }
        else if (exactPo.length > 1) {
            score += 10;
            reasons.push("ambiguous_po_multiple_records");
        }
        else {
            reasons.push("po_not_found");
        }
    }
    if (orderNumber) {
        const orderMatches = ctx.deliveries.filter((d) => d.orderNumber.toUpperCase() === orderNumber.toUpperCase());
        if (orderMatches.length === 1) {
            deliveryOrderId = orderMatches[0].id;
            jobId = jobId ?? orderMatches[0].jobId;
            vendorId = vendorId ?? orderMatches[0].vendorId;
            purchaseOrderId =
                purchaseOrderId ?? orderMatches[0].purchaseOrderId ?? undefined;
            score += 35;
            reasons.push("exact_order_number");
        }
        else if (orderMatches.length > 1) {
            score += 5;
            reasons.push("ambiguous_order_number");
        }
    }
    if (jobNumber && !jobId) {
        const jobMatches = ctx.jobs.filter((j) => j.jobNumber.toUpperCase() === jobNumber.toUpperCase());
        if (jobMatches.length === 1) {
            jobId = jobMatches[0].id;
            score += 15;
            reasons.push("exact_job_number");
        }
        else if (jobMatches.length > 1) {
            reasons.push("ambiguous_job_number");
        }
    }
    if (jobId && vendorId && poMatches.length > 1) {
        const narrowed = poMatches.filter((po) => po.jobId === jobId && po.vendorId === vendorId);
        if (narrowed.length === 1) {
            purchaseOrderId = narrowed[0].id;
            score += 10;
            reasons.push("po_narrowed_by_job_vendor");
        }
        else if (narrowed.length > 1) {
            score -= 20;
            reasons.push("same_vendor_multiple_open_pos");
        }
    }
    if (parsed.classification === "unable_to_match" || parsed.classification === "irrelevant") {
        score = Math.min(score, types_1.EMAIL_REVIEW_CONFIDENCE - 1);
        reasons.push(parsed.classification);
    }
    if (parsed.classification === "correction_to_earlier_email") {
        reasons.push("correction_to_earlier_email");
    }
    if (purchaseOrderId &&
        jobId &&
        vendorId &&
        parsed.poNumbers.length === 1 &&
        (deliveryOrderId || orderNumber)) {
        score += 10;
        reasons.push("consistent_po_job_vendor_order");
    }
    if (poNumber && jobNumber) {
        const po = purchaseOrderId
            ? ctx.purchaseOrders.find((p) => p.id === purchaseOrderId)
            : undefined;
        const job = jobId ? ctx.jobs.find((j) => j.id === jobId) : undefined;
        if (po && job && po.jobId !== job.id) {
            score -= 30;
            reasons.push("po_job_conflict");
        }
    }
    score = Math.max(0, Math.min(100, score));
    const humanReviewRequired = score < types_1.EMAIL_AUTO_APPLY_CONFIDENCE ||
        parsed.classification === "correction_to_earlier_email";
    return {
        vendorId,
        jobId,
        purchaseOrderId,
        deliveryOrderId,
        confidenceScore: score,
        confidenceReason: reasons.join("; ") || "insufficient_signals",
        humanReviewRequired,
    };
}
function shouldAutoApplyVendorOrderComplete(parsed, match) {
    if (!parsed.vendorOrderCompleteClaim)
        return false;
    if (match.humanReviewRequired)
        return false;
    if (match.confidenceScore < types_1.EMAIL_AUTO_APPLY_CONFIDENCE)
        return false;
    if (!match.purchaseOrderId && !match.deliveryOrderId)
        return false;
    if (parsed.classification === "order_acknowledged" ||
        parsed.classification === "ordered" ||
        parsed.classification === "shipped" ||
        parsed.classification === "partially_shipped" ||
        parsed.classification === "correction_to_earlier_email") {
        return false;
    }
    return true;
}
//# sourceMappingURL=matchEmailToRecords.js.map