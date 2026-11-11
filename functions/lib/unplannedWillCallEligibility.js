"use strict";
/**
 * Jobless unplanned (walk-in) delivery eligibility — dispatcher-only pickup/clear.
 * Do not fabricate a jobId. Technician / pickup-token doors stay job-linked.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAssignedJobId = hasAssignedJobId;
exports.isJoblessUnplannedDelivery = isJoblessUnplannedDelivery;
exports.isPickupLockedStatus = isPickupLockedStatus;
exports.isCancelledStatus = isCancelledStatus;
exports.isOccupancyClearedStatus = isOccupancyClearedStatus;
function hasAssignedJobId(delivery) {
    return String(delivery.jobId ?? "").trim().length > 0;
}
/** Vendor unplanned shell with no dispatcher job/PO match yet. */
function isJoblessUnplannedDelivery(delivery) {
    return delivery.unplanned === true && !hasAssignedJobId(delivery);
}
function isPickupLockedStatus(status) {
    return status === "picked_up" || status === "installed";
}
function isCancelledStatus(status) {
    return status === "cancelled";
}
/** Occupancy / receive must treat these as finished — spot is free. */
function isOccupancyClearedStatus(status) {
    return (status === "complete" ||
        status === "picked_up" ||
        status === "installed" ||
        status === "cancelled");
}
//# sourceMappingURL=unplannedWillCallEligibility.js.map