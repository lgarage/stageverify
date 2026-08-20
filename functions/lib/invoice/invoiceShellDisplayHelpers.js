"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInvoiceShellNoShopStaging = isInvoiceShellNoShopStaging;
exports.skipsShopStaging = skipsShopStaging;
exports.extractDeliverToSiteLabel = extractDeliverToSiteLabel;
exports.jobNameFromInvoicePo = jobNameFromInvoicePo;
exports.jobNameFromInvoiceContext = jobNameFromInvoiceContext;
exports.resolveShellDeliveryStatus = resolveShellDeliveryStatus;
const SHELL_DELIVERY_ID_PREFIX = "delivery-vii-";
function isVerifiedInvoiceShell(delivery) {
    if (delivery.createdFromInvoiceImport === true)
        return true;
    const id = delivery.id?.trim();
    if (id?.startsWith(SHELL_DELIVERY_ID_PREFIX))
        return true;
    const importId = delivery.vendorInvoiceImportId?.trim();
    if (importId && id === `${SHELL_DELIVERY_ID_PREFIX}${importId}`)
        return true;
    return false;
}
function isInvoiceShellNoShopStaging(delivery) {
    if (!isVerifiedInvoiceShell(delivery))
        return false;
    // Explicit Vendor Drop-Off wins over a stale will-call import status (drawer toggle).
    if (delivery.invoiceFulfillmentMethod === "delivery") {
        if (delivery.invoiceImportStatus === "closed_picked_up")
            return true;
        if (delivery.invoiceDeliverToSite === true)
            return true;
        return false;
    }
    if (delivery.invoiceImportStatus === "pickup_at_vendor")
        return true;
    if (delivery.invoiceImportStatus === "closed_picked_up")
        return true;
    if (delivery.invoiceFulfillmentMethod === "will_call_pickup")
        return true;
    if (delivery.invoiceDeliverToSite === true)
        return true;
    return false;
}
function skipsShopStaging(delivery) {
    if (isInvoiceShellNoShopStaging(delivery))
        return true;
    // Branch-B (non-shell) fallback — Drop-Off still wins over stale will-call signals.
    if (delivery.invoiceFulfillmentMethod === "delivery")
        return false;
    return (delivery.invoiceImportStatus === "pickup_at_vendor" ||
        delivery.invoiceFulfillmentMethod === "will_call_pickup");
}
/** Extract job-site destination from parsed order notes (e.g. DELIVER TO: Planet Fitness Hartford). */
function extractDeliverToSiteLabel(orderNotes) {
    for (let index = 0; index < orderNotes.length; index += 1) {
        const note = orderNotes[index] ?? "";
        const match = note.match(/DELIVER\s+TO\s*:\s*(.*)/i);
        if (!match)
            continue;
        let label = match[1]?.trim() ?? "";
        const next = orderNotes[index + 1]?.trim() ?? "";
        if (label &&
            next &&
            /^[A-Za-z]/.test(next) &&
            !/^(DATE|ATTN|PHONE|SHIP|SPECIAL)\b/i.test(next)) {
            label = `${label} ${next}`.trim();
        }
        if (label)
            return label;
    }
    return undefined;
}
function titleCaseWords(value) {
    return value
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}
function jobNameFromInvoicePo(customerPoOrReference) {
    return titleCaseWords(customerPoOrReference);
}
/** Prefer DELIVER TO / ship-to over raw customer P/O tokens for auto-created jobs. */
function jobNameFromInvoiceContext(customerPoOrReference, orderNotes, shipToName) {
    const deliverTo = extractDeliverToSiteLabel(orderNotes);
    if (deliverTo)
        return titleCaseWords(deliverTo);
    const shipTo = shipToName?.trim();
    if (shipTo)
        return titleCaseWords(shipTo);
    return jobNameFromInvoicePo(customerPoOrReference);
}
function resolveShellDeliveryStatus(importStatus, fulfillmentMethod, deliverToSite) {
    if (deliverToSite && importStatus === "pending") {
        return "complete";
    }
    switch (importStatus) {
        case "closed_picked_up":
            return "picked_up";
        case "pickup_at_vendor":
            // delivery.status reflects Vendor Drop-Off workflow, not raw parser importStatus
            return fulfillmentMethod === "delivery" ? "pending" : "ready_for_pickup";
        case "ready_for_pickup":
            return "complete";
        case "partial":
            return "partial";
        case "issue":
            return "issue";
        default:
            return "pending";
    }
}
//# sourceMappingURL=invoiceShellDisplayHelpers.js.map