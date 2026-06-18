"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePickupChecklist = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
function getDb() {
    return admin.firestore();
}
const MAX_ITEMS_PER_DELIVERY = 500;
const MAX_ITEM_ID_LEN = 128;
function asNonEmptyString(value, maxLen) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen)
        return null;
    return trimmed;
}
function asItemIdArray(value) {
    if (!Array.isArray(value))
        return null;
    if (value.length > MAX_ITEMS_PER_DELIVERY)
        return null;
    const out = [];
    for (const entry of value) {
        const parsed = asNonEmptyString(entry, MAX_ITEM_ID_LEN);
        if (!parsed)
            return null;
        out.push(parsed);
    }
    return out;
}
function checklistEligibleStatus(status) {
    return status === "ready_for_pickup" || status === "complete";
}
exports.updatePickupChecklist = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryOrderId = asNonEmptyString(data.deliveryOrderId, 128);
    const jobId = asNonEmptyString(data.jobId, 128);
    const pickupToken = (0, pickupTokenValidation_1.asPickupToken)(data.pickupToken);
    const pickupCheckedItemIds = asItemIdArray(data.pickupCheckedItemIds);
    if (!deliveryOrderId ||
        !jobId ||
        !pickupToken ||
        pickupCheckedItemIds === null) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId, jobId, pickupCheckedItemIds, and pickupToken are required.");
    }
    const db = getDb();
    await (0, pickupTokenValidation_1.verifyPickupTokenForJob)(db, pickupToken, jobId);
    return db.runTransaction(async (tx) => {
        const deliveryRef = db.collection("deliveries").doc(deliveryOrderId);
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const delivery = deliverySnap.data();
        if (delivery.jobId !== jobId) {
            throw new https_1.HttpsError("permission-denied", "Delivery does not belong to this job.");
        }
        if (!checklistEligibleStatus(delivery.status)) {
            throw new https_1.HttpsError("failed-precondition", "Delivery is not open for pickup checklist updates.");
        }
        const itemsSnap = await tx.get(db
            .collection("items")
            .where("deliveryOrderId", "==", deliveryOrderId)
            .limit(MAX_ITEMS_PER_DELIVERY + 1));
        if (itemsSnap.size > MAX_ITEMS_PER_DELIVERY) {
            throw new https_1.HttpsError("failed-precondition", "Delivery has too many line items for pickup checklist.");
        }
        const validItemIds = new Set(itemsSnap.docs.map((doc) => doc.id));
        for (const itemId of pickupCheckedItemIds) {
            if (!validItemIds.has(itemId)) {
                throw new https_1.HttpsError("invalid-argument", "pickupCheckedItemIds contains an item not on this delivery.");
            }
        }
        const now = new Date().toISOString();
        tx.update(deliveryRef, {
            pickupCheckedItemIds,
            updatedAt: now,
        });
        return {
            pickupCheckedItemIds,
        };
    });
});
//# sourceMappingURL=updatePickupChecklist.js.map