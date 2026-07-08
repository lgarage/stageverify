"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPickupDeliveryInstalled = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function getDb() {
    return admin.firestore();
}
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
/** Token-gated installed transition from pickup portal. */
exports.markPickupDeliveryInstalled = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryId = asDeliveryId(data.deliveryId);
    const jobId = asJobId(data.jobId);
    const pickupToken = (0, pickupTokenValidation_1.asPickupToken)(data.pickupToken);
    if (!deliveryId || !jobId || !pickupToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid pickup link.");
    }
    const db = getDb();
    await (0, pickupTokenValidation_1.verifyPickupTokenForJob)(db, pickupToken, jobId);
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    if (String(delivery.jobId ?? "") !== jobId) {
        throw new https_1.HttpsError("permission-denied", "Pickup link does not match this delivery.");
    }
    if (delivery.status !== "picked_up") {
        throw new https_1.HttpsError("failed-precondition", "Delivery must be picked up before marking installed.");
    }
    const itemsSnap = await db
        .collection("items")
        .where("deliveryOrderId", "==", deliveryId)
        .get();
    const now = new Date().toISOString();
    const eventId = `event-${crypto.randomUUID()}`;
    const batch = db.batch();
    batch.update(deliveryRef, {
        status: "installed",
        updatedAt: now,
    });
    for (const itemDoc of itemsSnap.docs) {
        const item = itemDoc.data();
        if (item.status === "received") {
            batch.update(itemDoc.ref, { status: "installed" });
        }
    }
    batch.set(db.collection("statusHistory").doc(eventId), {
        id: eventId,
        entityType: "delivery_order",
        entityId: deliveryId,
        fromStatus: delivery.status,
        toStatus: "installed",
        actorType: "technician",
        actorName: "Technician",
        createdAt: now,
    });
    await batch.commit();
    const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, deliveryId);
    return { details };
});
//# sourceMappingURL=markPickupDeliveryInstalled.js.map