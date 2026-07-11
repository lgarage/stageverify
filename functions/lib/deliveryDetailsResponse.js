"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZONE_CLEARED_DELIVERY_STATUSES = exports.RECEIVE_BLOCKED_DELIVERY_STATUSES = exports.PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES = exports.PICKUP_PORTAL_DELIVERY_STATUSES = void 0;
exports.sanitizeDeliveryForPublic = sanitizeDeliveryForPublic;
exports.hydratePublicDeliveryDetails = hydratePublicDeliveryDetails;
exports.getAllStagingLocationIds = getAllStagingLocationIds;
function publicVendorFromDelivery(delivery) {
    return {
        id: String(delivery.vendorId ?? ""),
        name: typeof delivery.vendorName === "string" && delivery.vendorName.trim()
            ? delivery.vendorName.trim()
            : "Vendor",
        createdAt: String(delivery.createdAt ?? ""),
    };
}
/** Strip notes and vendorPinVerifier from public vendor receive payloads. */
function sanitizeDeliveryForPublic(deliveryId, data) {
    const rest = { ...data };
    delete rest.notes;
    delete rest.vendorPinVerifier;
    return { ...rest, id: String(data.id ?? deliveryId) };
}
async function hydratePublicDeliveryDetails(db, deliveryId) {
    const deliverySnap = await db.collection("deliveries").doc(deliveryId).get();
    if (!deliverySnap.exists)
        return null;
    const deliveryData = deliverySnap.data();
    const [jobSnap, poSnap, locSnap, itemsSnap] = await Promise.all([
        db.collection("jobs").doc(String(deliveryData.jobId ?? "")).get(),
        deliveryData.purchaseOrderId
            ? db
                .collection("purchaseOrders")
                .doc(String(deliveryData.purchaseOrderId))
                .get()
            : Promise.resolve(null),
        deliveryData.stagingLocationId
            ? db
                .collection("stagingLocations")
                .doc(String(deliveryData.stagingLocationId))
                .get()
            : Promise.resolve(null),
        db
            .collection("items")
            .where("deliveryOrderId", "==", deliveryId)
            .get(),
    ]);
    const items = itemsSnap.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
    }));
    return {
        delivery: sanitizeDeliveryForPublic(deliveryId, deliveryData),
        vendor: publicVendorFromDelivery(deliveryData),
        items,
        job: jobSnap?.exists ? { ...jobSnap.data(), id: jobSnap.id } : undefined,
        purchaseOrder: poSnap?.exists
            ? { ...poSnap.data(), id: poSnap.id }
            : undefined,
        stagingLocation: locSnap?.exists
            ? { ...locSnap.data(), id: locSnap.id }
            : undefined,
        statusHistory: [],
        pickupEvents: [],
        materialIssues: [],
    };
}
exports.PICKUP_PORTAL_DELIVERY_STATUSES = [
    "ready_for_pickup",
    "picked_up",
    "installed",
];
exports.PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES = [
    "partial",
    "arrived",
];
exports.RECEIVE_BLOCKED_DELIVERY_STATUSES = new Set([
    "ready_for_pickup",
    "complete",
    "picked_up",
    "installed",
]);
exports.ZONE_CLEARED_DELIVERY_STATUSES = new Set([
    "picked_up",
    "installed",
]);
function getAllStagingLocationIds(delivery) {
    const ids = [];
    if (typeof delivery.stagingLocationId === "string" && delivery.stagingLocationId) {
        ids.push(delivery.stagingLocationId);
    }
    const extra = delivery.additionalStagingLocationIds;
    if (Array.isArray(extra)) {
        for (const id of extra) {
            if (typeof id === "string" && id && !ids.includes(id))
                ids.push(id);
        }
    }
    return ids;
}
//# sourceMappingURL=deliveryDetailsResponse.js.map