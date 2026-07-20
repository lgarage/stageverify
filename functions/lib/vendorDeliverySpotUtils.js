"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAssignableSpot = hasAssignableSpot;
exports.isActiveVendorDelivery = isActiveVendorDelivery;
exports.collectLocationIds = collectLocationIds;
exports.resolveLocationCodes = resolveLocationCodes;
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function hasAssignableSpot(delivery) {
    if (typeof delivery.stagingLocationId === "string" &&
        delivery.stagingLocationId.trim()) {
        return true;
    }
    const planned = delivery.plannedStagingLocationIds;
    if (Array.isArray(planned)) {
        return planned.some((id) => typeof id === "string" && id.trim().length > 0);
    }
    return false;
}
function isActiveVendorDelivery(delivery) {
    const status = String(delivery.status ?? "");
    if (deliveryDetailsResponse_1.ZONE_CLEARED_DELIVERY_STATUSES.has(status))
        return false;
    if (deliveryDetailsResponse_1.RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status))
        return false;
    return true;
}
function collectLocationIds(delivery) {
    const ids = (0, deliveryDetailsResponse_1.getAllStagingLocationIds)(delivery);
    const planned = delivery.plannedStagingLocationIds;
    if (Array.isArray(planned)) {
        for (const id of planned) {
            if (typeof id === "string" && id && !ids.includes(id))
                ids.push(id);
        }
    }
    return ids;
}
async function resolveLocationCodes(db, locationIds) {
    if (locationIds.length === 0)
        return [];
    const codes = [];
    for (const id of locationIds) {
        const snap = await db.collection("stagingLocations").doc(id).get();
        if (snap.exists) {
            const code = snap.data()?.code;
            if (typeof code === "string" && code.trim()) {
                codes.push(code.trim());
            }
        }
    }
    return codes;
}
//# sourceMappingURL=vendorDeliverySpotUtils.js.map