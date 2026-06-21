"use strict";
/** Server-side two-source readiness (mirrors src/dispatcher/readiness.ts). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePhysicalDropoffComplete = computePhysicalDropoffComplete;
exports.computeStagingAssignmentComplete = computeStagingAssignmentComplete;
exports.computeDeliveryReadiness = computeDeliveryReadiness;
exports.isPickupEligible = isPickupEligible;
function hasOutstandingQuantities(items) {
    return items.some((item) => item.qtyReceived < item.qtyOrdered ||
        item.qtyMissing > 0 ||
        item.qtyBackordered > 0);
}
function hasUnresolvedDamage(items) {
    return items.some((item) => item.qtyDamaged > 0);
}
function hasItemLevelPhysicalConflicts(items) {
    return hasOutstandingQuantities(items) || hasUnresolvedDamage(items);
}
function computeQtyBasedPhysicalDropoffComplete(items) {
    if (items.length === 0)
        return false;
    if (hasItemLevelPhysicalConflicts(items))
        return false;
    return items.every((item) => item.qtyReceived === item.qtyOrdered);
}
/** Physical drop-off: qty check-in (full_checkin) or vendor DELIVERED evidence (exception_only). */
function computePhysicalDropoffComplete(delivery, items, vendorDeliveryMode) {
    const mode = vendorDeliveryMode ?? "full_checkin";
    if (mode === "exception_only") {
        if (delivery.vendorPhysicalDropoffConfirmed !== true)
            return false;
        if (items.length === 0)
            return false;
        return !hasItemLevelPhysicalConflicts(items);
    }
    return computeQtyBasedPhysicalDropoffComplete(items);
}
function computeStagingAssignmentComplete(delivery, items) {
    const anyReceived = items.some((item) => item.qtyReceived > 0);
    const vendorConfirmedDropoff = delivery.vendorPhysicalDropoffConfirmed === true;
    if (!anyReceived && !vendorConfirmedDropoff)
        return true;
    return Boolean(delivery.stagingLocationId?.trim());
}
function computeDeliveryReadiness(delivery, items, now, vendorDeliveryMode) {
    const physicalDropoffComplete = computePhysicalDropoffComplete(delivery, items, vendorDeliveryMode);
    const stagingAssignmentComplete = computeStagingAssignmentComplete(delivery, items);
    const physicalDropoffCompleteAt = physicalDropoffComplete
        ? delivery.physicalDropoffCompleteAt ??
            delivery.vendorPhysicalDropoffConfirmedAt ??
            now
        : undefined;
    const blockReasons = [];
    const vendorOrderComplete = delivery.vendorOrderComplete === true;
    const blockingIssues = (delivery.openBlockingIssueCount ?? 0) > 0;
    if (!vendorOrderComplete)
        blockReasons.push("vendor_order_incomplete");
    if (!physicalDropoffComplete)
        blockReasons.push("physical_dropoff_incomplete");
    if (!stagingAssignmentComplete) {
        blockReasons.push("staging_assignment_incomplete");
    }
    if (blockingIssues)
        blockReasons.push("unresolved_blocking_issues");
    if (hasUnresolvedDamage(items))
        blockReasons.push("unresolved_damage");
    if (items.some((item) => item.qtyBackordered > 0)) {
        blockReasons.push("unresolved_backorder");
    }
    const evidence = {
        vendorOrderComplete,
        physicalDropoffComplete,
        stagingAssignmentComplete,
        readinessBlockReasons: blockReasons,
    };
    if (delivery.status === "picked_up" || delivery.status === "installed") {
        return {
            readyForPickup: false,
            readinessStatus: "picked_up",
            deliveryStatus: delivery.status,
            evidence,
            physicalDropoffComplete,
            physicalDropoffCompleteAt,
            stagingAssignmentComplete,
        };
    }
    const readyForPickup = blockReasons.length === 0;
    if (readyForPickup) {
        return {
            readyForPickup: true,
            readinessStatus: "ready_for_pickup",
            deliveryStatus: "ready_for_pickup",
            evidence,
            physicalDropoffComplete,
            physicalDropoffCompleteAt,
            stagingAssignmentComplete,
        };
    }
    const anyReceived = items.some((item) => item.qtyReceived > 0);
    const vendorOnly = vendorOrderComplete && !physicalDropoffComplete;
    const physicalOnly = physicalDropoffComplete && !vendorOrderComplete;
    let deliveryStatus = delivery.status;
    if (anyReceived || vendorOnly || physicalOnly) {
        deliveryStatus = "partial";
    }
    else if (delivery.status === "pending" ||
        delivery.status === "shipped" ||
        delivery.status === "arrived" ||
        delivery.status === "issue") {
        deliveryStatus = delivery.status;
    }
    else {
        deliveryStatus = "partial";
    }
    return {
        readyForPickup: false,
        readinessStatus: "not_ready",
        deliveryStatus,
        evidence,
        physicalDropoffComplete,
        physicalDropoffCompleteAt,
        stagingAssignmentComplete,
    };
}
/** Pickup eligibility: blocking issues may block readiness promotion only. */
function isPickupEligible(delivery, items, vendorDeliveryMode) {
    if (delivery.status === "picked_up" || delivery.status === "installed") {
        return { eligible: false, reason: "already_picked_up" };
    }
    if (delivery.status !== "ready_for_pickup" &&
        delivery.status !== "complete") {
        return { eligible: false, reason: "delivery_not_ready_for_pickup" };
    }
    const readiness = computeDeliveryReadiness(delivery, items, new Date().toISOString(), vendorDeliveryMode);
    const pickupBlockReasons = readiness.evidence.readinessBlockReasons.filter((reason) => reason !== "unresolved_blocking_issues");
    if (pickupBlockReasons.length > 0) {
        return {
            eligible: false,
            reason: pickupBlockReasons.join(", ") || "not_ready",
        };
    }
    return { eligible: true };
}
//# sourceMappingURL=deliveryReadiness.js.map