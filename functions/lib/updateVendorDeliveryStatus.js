"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVendorDeliveryStatus = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function getDb() {
    return admin.firestore();
}
const VALID_TRANSITIONS = {
    pending: ["shipped", "arrived", "issue"],
    shipped: ["arrived", "issue"],
    arrived: ["partial", "issue"],
    partial: ["arrived", "issue"],
    ready_for_pickup: ["arrived", "issue"],
    complete: ["arrived", "issue"],
};
const VENDOR_REVERT_TARGETS = {
    partial: "arrived",
    ready_for_pickup: "arrived",
    complete: "arrived",
};
function asToStatus(value) {
    const allowed = [
        "pending",
        "shipped",
        "arrived",
        "partial",
        "ready_for_pickup",
        "complete",
        "issue",
        "picked_up",
        "installed",
    ];
    if (typeof value !== "string")
        return null;
    return allowed.includes(value)
        ? value
        : null;
}
function asRevertWindow(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 60;
    return Math.min(Math.max(Math.floor(value), 1), 24 * 60);
}
/** Session-gated vendor status updates and revert — replaces unauth delivery writes. */
exports.updateVendorDeliveryStatus = (0, https_1.onCall)({
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
    const action = data.action === "revert" ? "revert" : "update";
    const toStatus = asToStatus(data.toStatus);
    const vendorRevertWindowMinutes = asRevertWindow(data.vendorRevertWindowMinutes);
    const actorName = typeof data.actorName === "string" && data.actorName.trim()
        ? data.actorName.trim().slice(0, 128)
        : "Vendor Driver";
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    const fromStatus = delivery.status;
    if (action === "revert") {
        let target = VENDOR_REVERT_TARGETS[fromStatus];
        if (!target && fromStatus === "arrived" && delivery.submittedAt) {
            target = "arrived";
        }
        if (!target) {
            const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
            return { details };
        }
        const submittedAt = delivery.submittedAt;
        if (!submittedAt) {
            const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
            return { details };
        }
        const elapsedMs = Date.now() - new Date(String(submittedAt)).getTime();
        if (elapsedMs > vendorRevertWindowMinutes * 60 * 1000) {
            const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
            return { details };
        }
        const now = new Date().toISOString();
        const eventId = `event-${crypto.randomUUID()}`;
        const batch = db.batch();
        const clearSubmitted = target === "arrived" ||
            (fromStatus === "arrived" && Boolean(delivery.submittedAt));
        const clearPhysicalEvidence = clearSubmitted || delivery.vendorPhysicalDropoffConfirmed === true;
        batch.update(deliveryRef, {
            status: target,
            submittedAt: clearSubmitted ? null : delivery.submittedAt ?? null,
            ...(clearPhysicalEvidence
                ? {
                    vendorPhysicalDropoffConfirmed: false,
                    vendorPhysicalDropoffConfirmedAt: null,
                    deliveredAt: null,
                    physicalDropoffSource: null,
                }
                : {}),
            updatedAt: now,
        });
        batch.set(db.collection("statusHistory").doc(eventId), {
            id: eventId,
            entityType: "delivery_order",
            entityId: deliveryId,
            fromStatus,
            toStatus: target,
            reason: "Reverted",
            actorType: "vendor",
            actorName,
            createdAt: now,
        });
        await batch.commit();
        await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(db, deliveryId, {
            historyReason: "Vendor revert readiness recalculation",
        });
        const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
        return { details };
    }
    if (!toStatus) {
        throw new https_1.HttpsError("invalid-argument", "Invalid status.");
    }
    if (toStatus === "picked_up" || toStatus === "ready_for_pickup") {
        throw new https_1.HttpsError("permission-denied", "Status change not allowed.");
    }
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed?.includes(toStatus)) {
        const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
        return { details };
    }
    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = db.batch();
    batch.update(deliveryRef, {
        status: toStatus,
        updatedAt: now,
    });
    batch.set(db.collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus,
        toStatus,
        actorType: "vendor",
        actorName,
        createdAt: now,
    });
    await batch.commit();
    const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
    return { details };
});
//# sourceMappingURL=updateVendorDeliveryStatus.js.map