"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markCatchAllDeliveryReceived = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const managementSessionValidation_1 = require("./managementSessionValidation");
function getDb() {
    return admin.firestore();
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
/** D-41 narrow exception — packing-slip checkmark marks expected delivery received at catch-all. */
exports.markCatchAllDeliveryReceived = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, managementSessionValidation_1.asManagementSessionToken)(data.sessionToken);
    const deliveryId = asDeliveryId(data.deliveryId);
    if (!sessionToken || !deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await (0, managementSessionValidation_1.assertManagementCatchAllSession)(sessionToken);
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    const fromStatus = delivery.status;
    if (delivery.reviewFlag?.flagged === true || deliveryId.startsWith("delivery-unid-")) {
        throw new https_1.HttpsError("failed-precondition", "Flagged shells cannot be marked received from catch-all intake.");
    }
    if (fromStatus !== "pending" && fromStatus !== "shipped") {
        if (delivery.vendorPhysicalDropoffConfirmed === true &&
            fromStatus === "arrived") {
            return {
                deliveryId,
                status: fromStatus,
                idempotent: true,
            };
        }
        throw new https_1.HttpsError("failed-precondition", "Delivery is not waiting for parts.");
    }
    const now = new Date().toISOString();
    const toStatus = "arrived";
    if (delivery.vendorPhysicalDropoffConfirmed === true) {
        await deliveryRef.update({
            status: toStatus,
            updatedAt: now,
        });
        const readiness = await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryId, { historyReason: "Catch-all mark-received status repair" });
        return {
            deliveryId,
            status: toStatus,
            idempotent: true,
            readiness,
        };
    }
    const batch = getDb().batch();
    batch.update(deliveryRef, {
        status: toStatus,
        submittedAt: now,
        vendorPhysicalDropoffConfirmed: true,
        vendorPhysicalDropoffConfirmedAt: now,
        deliveredAt: now,
        physicalDropoffSource: "catch_all_intake",
        scannedStagingLocationId: session.scannedStagingLocationId,
        scannedAt: now,
        stagingLocationId: delivery.stagingLocationId ?? session.scannedStagingLocationId,
        updatedAt: now,
    });
    const eventId = `event-${crypto.randomUUID()}`;
    batch.set(getDb().collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus,
        reason: "Catch-all packing-slip checkmark (D-41)",
        actorType: "management",
        actorName: "Office intake",
        createdAt: now,
    });
    const logId = `catch-all-${crypto.randomUUID().slice(0, 12)}`;
    batch.set(getDb().collection("pinVerificationEvents").doc(logId), {
        id: logId,
        action: "CATCH_ALL_MARK_RECEIVED",
        deliveryId,
        timestamp: now,
        createdAt: now,
        stagingLocationCode: session.scannedStagingLocationCode,
    });
    await batch.commit();
    const readiness = await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryId, { historyReason: "Catch-all mark-received readiness recalculation" });
    return {
        deliveryId,
        status: toStatus,
        vendorPhysicalDropoffConfirmed: true,
        vendorPhysicalDropoffConfirmedAt: now,
        idempotent: false,
        readiness,
    };
});
//# sourceMappingURL=markCatchAllDeliveryReceived.js.map