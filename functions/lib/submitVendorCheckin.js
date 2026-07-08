"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitVendorCheckin = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function getDb() {
    return admin.firestore();
}
function asDriverName(value) {
    if (typeof value !== "string")
        return "Vendor Driver";
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}
function asItemUpdates(value) {
    if (!Array.isArray(value) || value.length > 500)
        return null;
    return value;
}
function computeItemStatus(update) {
    if (update.qtyReceived === update.qtyOrdered)
        return "received";
    if (update.qtyReceived > 0)
        return "partial";
    if (update.qtyDamaged > 0)
        return "damaged";
    return "missing";
}
/** Session-gated vendor check-in — replaces unauth Firestore batch writes. */
exports.submitVendorCheckin = (0, https_1.onCall)({
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
    const driverName = asDriverName(data.driverName);
    const itemUpdates = asItemUpdates(data.itemUpdates);
    if (!deliveryId || !sessionToken || !itemUpdates) {
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
    const itemsSnap = await db
        .collection("items")
        .where("deliveryOrderId", "==", deliveryId)
        .get();
    const existingItems = new Map(itemsSnap.docs.map((docSnap) => [docSnap.id, docSnap.data()]));
    const batch = db.batch();
    for (const update of itemUpdates) {
        const itemId = typeof update.id === "string" ? update.id.trim() : "";
        if (!itemId)
            continue;
        const existingItem = existingItems.get(itemId);
        if (!existingItem) {
            throw new https_1.HttpsError("permission-denied", "Item does not belong to this delivery.");
        }
        const qtyOrdered = typeof existingItem.qtyOrdered === "number"
            ? existingItem.qtyOrdered
            : 0;
        const qtyReceivedRaw = update.qtyReceived;
        const qtyMissingRaw = update.qtyMissing;
        const qtyDamagedRaw = update.qtyDamaged;
        if (typeof qtyReceivedRaw !== "number" ||
            !Number.isInteger(qtyReceivedRaw) ||
            qtyReceivedRaw < 0 ||
            qtyReceivedRaw > 9999 ||
            typeof qtyMissingRaw !== "number" ||
            !Number.isInteger(qtyMissingRaw) ||
            qtyMissingRaw < 0 ||
            qtyMissingRaw > 9999 ||
            typeof qtyDamagedRaw !== "number" ||
            !Number.isInteger(qtyDamagedRaw) ||
            qtyDamagedRaw < 0 ||
            qtyDamagedRaw > 9999) {
            throw new https_1.HttpsError("invalid-argument", "Invalid item quantities.");
        }
        const qtyReceived = qtyReceivedRaw;
        const qtyMissing = qtyMissingRaw;
        const qtyDamaged = qtyDamagedRaw;
        const status = computeItemStatus({
            qtyReceived,
            qtyMissing,
            qtyDamaged,
            qtyOrdered,
        });
        batch.update(db.collection("items").doc(itemId), {
            qtyReceived,
            qtyMissing,
            qtyDamaged,
            status,
        });
    }
    const now = new Date().toISOString();
    const anyReceivedAfterCheckIn = itemUpdates.some((update) => (update.qtyReceived ?? 0) > 0);
    const vendorStatus = fromStatus === "arrived" && anyReceivedAfterCheckIn
        ? "partial"
        : fromStatus;
    batch.update(deliveryRef, {
        submittedAt: now,
        status: vendorStatus,
        updatedAt: now,
    });
    if (fromStatus !== vendorStatus) {
        const eventId = `event-${crypto.randomUUID()}`;
        batch.set(db.collection("statusHistory").doc(eventId), {
            id: eventId,
            entityType: "delivery_order",
            entityId: deliveryId,
            fromStatus,
            toStatus: vendorStatus,
            actorType: "vendor",
            actorName: driverName,
            createdAt: now,
        });
    }
    await batch.commit();
    await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(db, deliveryId, {
        historyReason: "Vendor check-in readiness recalculation",
    });
    const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
    return { details };
});
//# sourceMappingURL=submitVendorCheckin.js.map