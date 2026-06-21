"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markVendorDelivered = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
function asActorName(value) {
    if (typeof value !== "string")
        return "Vendor Driver";
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}
/** Server-owned vendor DELIVERED — validates session, writes evidence, recalculates readiness. */
exports.markVendorDelivered = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.deliveryId);
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    const actorName = asActorName(data.actorName);
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    const alreadyConfirmed = delivery.vendorPhysicalDropoffConfirmed === true;
    const fromStatus = delivery.status;
    const toStatus = fromStatus === "pending" || fromStatus === "shipped" ? "arrived" : fromStatus;
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
    const readiness = await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryId, { historyReason: "Vendor DELIVERED readiness recalculation" });
    return {
        deliveryId,
        status: toStatus,
        vendorPhysicalDropoffConfirmed: true,
        vendorPhysicalDropoffConfirmedAt: confirmedAt,
        idempotent: alreadyConfirmed && fromStatus === toStatus,
        readiness,
    };
});
//# sourceMappingURL=markVendorDelivered.js.map