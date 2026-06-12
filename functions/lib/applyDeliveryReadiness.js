"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ITEMS_PER_DELIVERY = void 0;
exports.applyDeliveryReadinessTransaction = applyDeliveryReadinessTransaction;
const deliveryReadiness_1 = require("./deliveryReadiness");
exports.MAX_ITEMS_PER_DELIVERY = 500;
/** Shared authoritative readiness write — used by callable CF and scheduled auto-submit. */
async function applyDeliveryReadinessTransaction(db, deliveryOrderId, options) {
    const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
    const historyReason = options?.historyReason ?? "Server readiness recalculation";
    return db.runTransaction(async (tx) => {
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists) {
            throw new Error(`Delivery not found: ${deliveryOrderId}`);
        }
        const delivery = deliverySnap.data();
        const itemsSnap = await tx.get(db
            .collection("items")
            .where("deliveryOrderId", "==", deliveryOrderId)
            .limit(exports.MAX_ITEMS_PER_DELIVERY + 1));
        if (itemsSnap.empty) {
            throw new Error(`Delivery has no items: ${deliveryOrderId}`);
        }
        if (itemsSnap.size > exports.MAX_ITEMS_PER_DELIVERY) {
            throw new Error(`Delivery has too many line items for readiness calculation: ${deliveryOrderId}`);
        }
        const items = itemsSnap.docs.map((doc) => doc.data());
        const now = new Date().toISOString();
        const result = (0, deliveryReadiness_1.computeDeliveryReadiness)(delivery, items, now);
        const fromStatus = delivery.status;
        tx.update(deliveryRef, {
            physicalDropoffComplete: result.physicalDropoffComplete,
            physicalDropoffCompleteAt: result.physicalDropoffCompleteAt ?? null,
            stagingAssignmentComplete: result.stagingAssignmentComplete,
            readinessStatus: result.readinessStatus,
            readinessBlockReasons: result.evidence.readinessBlockReasons,
            status: result.deliveryStatus,
            updatedAt: now,
        });
        if (fromStatus !== result.deliveryStatus) {
            const historyId = `event-readiness-${crypto.randomUUID()}`;
            tx.set(db.collection("statusHistory").doc(historyId), {
                id: historyId,
                entityType: "delivery_order",
                entityId: deliveryOrderId,
                fromStatus,
                toStatus: result.deliveryStatus,
                reason: historyReason,
                actorType: "system",
                actorName: "StageVerify",
                createdAt: now,
            });
        }
        return {
            deliveryOrderId,
            readyForPickup: result.readyForPickup,
            readinessStatus: result.readinessStatus,
            deliveryStatus: result.deliveryStatus,
            readinessBlockReasons: result.evidence.readinessBlockReasons,
            statusChanged: fromStatus !== result.deliveryStatus,
            fromStatus,
        };
    });
}
//# sourceMappingURL=applyDeliveryReadiness.js.map