"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferFulfillmentMethod = inferFulfillmentMethod;
exports.inferShipCompletePolicy = inferShipCompletePolicy;
exports.assessFulfillmentCompleteness = assessFulfillmentCompleteness;
exports.deriveImportStatus = deriveImportStatus;
exports.scoreInvoiceConfidence = scoreInvoiceConfidence;
/** Fulfillment method from explicit header/shipping language only — never from backorder lines or ship-complete policy. */
function inferFulfillmentMethod(customerPoOrReference, shipViaRaw, pageText) {
    const shipVia = (shipViaRaw ?? "").trim();
    const text = pageText ?? "";
    if (/\bPICKUP\b/i.test(customerPoOrReference))
        return "will_call_pickup";
    if (/\bWILL\s*[- ]?\s*CALL\b/i.test(customerPoOrReference))
        return "will_call_pickup";
    if (/\bWILL\s*CALL\b/i.test(text))
        return "will_call_pickup";
    if (/\bCUSTOMER\s+PICKUP\b/i.test(text))
        return "will_call_pickup";
    if (shipVia && /\bPICKUP\b/i.test(shipVia))
        return "will_call_pickup";
    if (shipVia && /\bWILL\s*[- ]?\s*CALL\b/i.test(shipVia))
        return "will_call_pickup";
    if (shipVia && /\bPU\b/i.test(shipVia))
        return "will_call_pickup";
    if (shipVia && /TRUCK\s+DELIVE/i.test(shipVia))
        return "delivery";
    if (/DELIVERY\s+ROUTE/i.test(text))
        return "delivery";
    if (/DELIVERED\s+BY\s+JOHNSTONE/i.test(text))
        return "delivery";
    return "unknown";
}
/** Ship-complete hold policy from explicit header/message language — not fulfillment method. */
function inferShipCompletePolicy(pageText) {
    const text = pageText ?? "";
    if (/\bSHIP\s+COMPLETE\b/i.test(text))
        return "hold_until_complete";
    if (/\bDELIVERY\s+HOLD\b/i.test(text))
        return "hold_until_complete";
    if (/\bPARTIAL\s+(?:SHIP(?:MENT)?|DELIVERY)\s+(?:OK|ALLOWED)\b/i.test(text)) {
        return "allow_partial";
    }
    return "unknown";
}
/** Line-level completeness — backorders affect status/review, not fulfillment method. */
function assessFulfillmentCompleteness(parsed) {
    const expectedLines = parsed.lines.filter((l) => !l.excludeFromExpectedItems);
    if (expectedLines.length === 0) {
        return {
            allFulfilled: false,
            hasBackorder: false,
            hasPartialShip: false,
            noFulfilledMaterial: true,
        };
    }
    const hasBackorder = expectedLines.some((l) => l.quantityBackordered > 0);
    const hasPartialShip = expectedLines.some((l) => l.quantityShipped < l.quantityOrdered && l.quantityBackordered === 0);
    const noFulfilledMaterial = expectedLines.every((l) => l.quantityShipped === 0);
    const allFulfilled = expectedLines.every((l) => l.quantityShipped >= l.quantityOrdered && l.quantityBackordered === 0);
    return { allFulfilled, hasBackorder, hasPartialShip, noFulfilledMaterial };
}
/** Derive import-domain status from parsed invoice — never sets shop readiness (spec §7). */
function deriveImportStatus(parsed, formatId = "johnstone") {
    const { header, parseWarnings } = parsed;
    const criticalWarnings = parseWarnings.filter((warning) => {
        if (warning === "missing vendorOrderNumber" && header.vendorInvoiceNumber)
            return false;
        if (warning === "missing vendorInvoiceNumber" && header.vendorOrderNumber && formatId === "generic") {
            return false;
        }
        if (warning.startsWith("uncertain:"))
            return false;
        if (warning === "missing product lines")
            return true;
        return warning.includes("missing vendorInvoiceNumber") || warning.includes("Unrecognized");
    });
    if (criticalWarnings.length > 0) {
        return "issue";
    }
    if (formatId === "unknown") {
        const hasIdentity = Boolean(header.vendorInvoiceNumber || header.vendorOrderNumber);
        const hasLines = parsed.lines.some((l) => l.lineType === "product");
        if (!hasIdentity && !hasLines)
            return "issue";
    }
    const { allFulfilled, hasBackorder, hasPartialShip, noFulfilledMaterial } = assessFulfillmentCompleteness(parsed);
    const incomplete = hasBackorder || hasPartialShip || noFulfilledMaterial;
    if (incomplete) {
        // Backorders / unfulfilled qty affect completeness only — do not assume future pickup or delivery.
        return "partial";
    }
    if (allFulfilled && header.fulfillmentMethod === "will_call_pickup") {
        return "pickup_at_vendor";
    }
    if (header.fulfillmentMethod === "delivery") {
        return "pending";
    }
    return "pending";
}
function scoreInvoiceConfidence(parsed, formatId = "johnstone") {
    const required = formatId === "first_supply"
        ? [
            parsed.header.customerAccountNumber,
            parsed.header.vendorInvoiceNumber,
            parsed.header.customerPoOrReference,
            parsed.header.orderDate,
            parsed.header.invoiceDate,
        ]
        : formatId === "generic"
            ? [
                parsed.header.vendorInvoiceNumber,
                parsed.header.customerPoOrReference,
            ]
            : [
                parsed.header.customerAccountNumber,
                parsed.header.vendorOrderNumber,
                parsed.header.vendorInvoiceNumber,
                parsed.header.customerPoOrReference,
                parsed.header.orderDate,
                parsed.header.invoiceDate,
                parsed.header.vendorBranchPhone,
            ];
    const missingRequired = required.filter((v) => !v).length;
    const productLines = parsed.lines.filter((l) => l.lineType === "product");
    const { hasBackorder, hasPartialShip, noFulfilledMaterial } = assessFulfillmentCompleteness(parsed);
    const shipCompleteHold = parsed.header.shipCompletePolicy === "hold_until_complete" &&
        (hasBackorder || noFulfilledMaterial);
    let score = 100;
    score -= missingRequired * 15;
    if (productLines.length === 0)
        score -= 30;
    if (parsed.header.fulfillmentMethod === "unknown")
        score -= 10;
    if (parsed.parseWarnings.length > 0)
        score -= parsed.parseWarnings.length * 5;
    score = Math.max(0, Math.min(100, score));
    let tier = "high";
    if (score < 60)
        tier = "low";
    else if (score < 85)
        tier = "medium";
    const humanReviewRequired = formatId === "generic" ||
        tier !== "high" ||
        parsed.header.fulfillmentMethod === "unknown" ||
        hasBackorder ||
        hasPartialShip ||
        noFulfilledMaterial ||
        shipCompleteHold;
    return { tier, score, humanReviewRequired };
}
//# sourceMappingURL=inferImportStatus.js.map