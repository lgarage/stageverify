"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryStatusFromImportStatus = deliveryStatusFromImportStatus;
/** Map import-domain status to delivery workflow status. */
function deliveryStatusFromImportStatus(importStatus) {
    switch (importStatus) {
        case "closed_picked_up":
            return "picked_up";
        case "pickup_at_vendor":
            return "ready_for_pickup";
        case "partial":
            return "partial";
        case "issue":
            return "issue";
        case "ready_for_pickup":
            return "complete";
        case "pending":
        default:
            return "pending";
    }
}
//# sourceMappingURL=deliveryStatusFromImportStatus.js.map