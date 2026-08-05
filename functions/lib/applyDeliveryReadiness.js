"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ITEMS_PER_DELIVERY = void 0;
exports.applyDeliveryReadinessTransaction = applyDeliveryReadinessTransaction;
const deliveryReadiness_1 = require("./deliveryReadiness");
exports.MAX_ITEMS_PER_DELIVERY = 500;
/** Shared authoritative readiness write — used by callable CF and scheduled auto-submit. */
async function applyDeliveryReadinessTransaction(db, deliveryOrderId, options) {
    const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
    const settingsRef = db.collection("appSettings").doc("config");
    const historyReason = options?.historyReason ?? "Server readiness recalculation";
    return db.runTransaction(async (tx) => {
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists) {
            throw new Error(`Delivery not found: ${deliveryOrderId}`);
        }
        const settingsSnap = await tx.get(settingsRef);
        const vendorDeliveryMode = settingsSnap.data()?.vendorDeliveryMode ?? "full_checkin";
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
        const result = (0, deliveryReadiness_1.computeDeliveryReadiness)(delivery, items, now, vendorDeliveryMode);
        const fromStatus = delivery.status;
        const lockedTerminal = fromStatus === "picked_up" || fromStatus === "installed";
        const closedPickedUp = delivery.invoiceImportStatus === "closed_picked_up";
        const deliveryPatch = {
            physicalDropoffComplete: result.physicalDropoffComplete,
            physicalDropoffCompleteAt: result.physicalDropoffCompleteAt ?? null,
            stagingAssignmentComplete: result.stagingAssignmentComplete,
            readinessBlockReasons: result.evidence.readinessBlockReasons,
            updatedAt: now,
        };
        if (closedPickedUp) {
            deliveryPatch.status = "picked_up";
            deliveryPatch.readinessStatus = "picked_up";
        }
        else if (!lockedTerminal) {
            deliveryPatch.readinessStatus = result.readinessStatus;
            deliveryPatch.status = result.deliveryStatus;
        }
        tx.update(deliveryRef, deliveryPatch);
        const effectiveStatus = lockedTerminal
            ? fromStatus
            : closedPickedUp
                ? "picked_up"
                : result.deliveryStatus;
        const statusChanged = !lockedTerminal &&
            fromStatus !== effectiveStatus &&
            (closedPickedUp || fromStatus !== result.deliveryStatus);
        if (statusChanged) {
            const historyId = `event-readiness-${crypto.randomUUID()}`;
            tx.set(db.collection("statusHistory").doc(historyId), {
                id: historyId,
                entityType: "delivery_order",
                entityId: deliveryOrderId,
                fromStatus,
                toStatus: effectiveStatus,
                reason: historyReason,
                actorType: "system",
                actorName: "StageVerify",
                createdAt: now,
            });
        }
        return {
            deliveryOrderId,
            readyForPickup: lockedTerminal || closedPickedUp ? false : result.readyForPickup,
            readinessStatus: lockedTerminal || closedPickedUp ? "picked_up" : result.readinessStatus,
            deliveryStatus: effectiveStatus,
            readinessBlockReasons: result.evidence.readinessBlockReasons,
            statusChanged,
            fromStatus,
        };
    });
}
//# sourceMappingURL=applyDeliveryReadiness.js.map