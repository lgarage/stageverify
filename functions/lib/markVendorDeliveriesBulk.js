"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markVendorDeliveriesBulk = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const vendorDeliverySpotUtils_1 = require("./vendorDeliverySpotUtils");
function getDb() {
    return admin.firestore();
}
const MAX_BULK_IDS = 50;
function asActorName(value) {
    if (typeof value !== "string")
        return "Vendor Driver";
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}
function asDeliveryIdList(value) {
    if (!Array.isArray(value))
        return null;
    const ids = [];
    for (const entry of value) {
        const id = (0, vendorSessionValidation_1.asDeliveryId)(entry);
        if (!id)
            return null;
        if (!ids.includes(id))
            ids.push(id);
    }
    return ids.length > 0 ? ids : null;
}
async function markOneDeliveryDelivered(deliveryId, sessionToken, actorName) {
    try {
        await (0, vendorSessionValidation_1.assertVendorSessionForDelivery)(sessionToken, deliveryId);
        const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
        const deliverySnap = await deliveryRef.get();
        if (!deliverySnap.exists) {
            return { deliveryId, success: false, error: "Delivery not found." };
        }
        const delivery = deliverySnap.data();
        if (!(0, vendorDeliverySpotUtils_1.hasAssignableSpot)(deliverySnap.data())) {
            return {
                deliveryId,
                success: false,
                error: "No assigned spot — ask dispatch.",
            };
        }
        const alreadyConfirmed = delivery.vendorPhysicalDropoffConfirmed === true;
        const fromStatus = delivery.status;
        const toStatus = fromStatus === "pending" || fromStatus === "shipped"
            ? "arrived"
            : fromStatus;
        const now = new Date().toISOString();
        const confirmedAt = alreadyConfirmed && delivery.vendorPhysicalDropoffConfirmedAt
            ? delivery.vendorPhysicalDropoffConfirmedAt
            : now;
        const batch = getDb().batch();
        batch.update(deliveryRef, {
            status: toStatus,
            submittedAt: now,
            vendorPhysicalDropoffConfirmed: true,
            vendorPhysicalDropoffConfirmedAt: confirmedAt,
            deliveredAt: alreadyConfirmed && delivery.deliveredAt ? delivery.deliveredAt : now,
            physicalDropoffSource: "physical_checkin",
            updatedAt: now,
        });
        if (fromStatus !== toStatus) {
            const eventId = `event-${crypto.randomUUID()}`;
            batch.set(getDb().collection("statusHistory").doc(eventId), {
                id: eventId,
                entityType: "delivery_order",
                entityId: deliveryId,
                fromStatus,
                toStatus,
                reason: "Vendor confirmed delivery",
                actorType: "vendor",
                actorName,
                createdAt: now,
            });
        }
        await batch.commit();
        await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryId, {
            historyReason: "Vendor DELIVERED readiness recalculation",
        });
        return {
            deliveryId,
            success: true,
            status: toStatus,
            vendorPhysicalDropoffConfirmed: true,
            idempotent: alreadyConfirmed && fromStatus === toStatus,
        };
    }
    catch (err) {
        const message = err instanceof https_1.HttpsError
            ? err.message
            : err instanceof Error
                ? err.message
                : "Mark delivered failed.";
        return { deliveryId, success: false, error: message };
    }
}
/** Bulk vendor DELIVERED — vendor-scoped sessions; per-id results on partial failure. */
exports.markVendorDeliveriesBulk = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    const deliveryIds = asDeliveryIdList(data.deliveryIds);
    const actorName = asActorName(data.actorName);
    if (!sessionToken || !deliveryIds) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    if (deliveryIds.length > MAX_BULK_IDS) {
        throw new https_1.HttpsError("invalid-argument", `Too many deliveries (max ${MAX_BULK_IDS}).`);
    }
    const results = [];
    for (const deliveryId of deliveryIds) {
        results.push(await markOneDeliveryDelivered(deliveryId, sessionToken, actorName));
    }
    return { results };
});
//# sourceMappingURL=markVendorDeliveriesBulk.js.map