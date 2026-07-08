"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVendorItemQty = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
function asItemId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
function asNonNegativeInt(value, max = 9999) {
    if (typeof value !== "number" || !Number.isInteger(value))
        return null;
    if (value < 0 || value > max)
        return null;
    return value;
}
/** Session-gated debounced item qty updates on vendor receive. */
exports.updateVendorItemQty = (0, https_1.onCall)({
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
    const itemId = asItemId(data.itemId);
    const qtyOrdered = asNonNegativeInt(data.qtyOrdered);
    const qtyReceived = asNonNegativeInt(data.qtyReceived);
    const qtyMissing = asNonNegativeInt(data.qtyMissing);
    if (!deliveryId ||
        !sessionToken ||
        !itemId ||
        qtyOrdered === null ||
        qtyReceived === null ||
        qtyMissing === null) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const db = getDb();
    const itemSnap = await db.collection("items").doc(itemId).get();
    if (!itemSnap.exists) {
        throw new https_1.HttpsError("not-found", "Item not found.");
    }
    const itemData = itemSnap.data();
    if (String(itemData.deliveryOrderId ?? "") !== deliveryId) {
        throw new https_1.HttpsError("permission-denied", "Item does not belong to this delivery.");
    }
    let itemStatus = "missing";
    if (qtyReceived >= qtyOrdered)
        itemStatus = "received";
    else if (qtyReceived > 0)
        itemStatus = "partial";
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.update(db.collection("items").doc(itemId), {
        qtyReceived,
        qtyMissing,
        status: itemStatus,
    });
    batch.update(db.collection("deliveries").doc(deliveryId), {
        lastCheckmarkAt: now,
        updatedAt: now,
    });
    await batch.commit();
    return { ok: true };
});
//# sourceMappingURL=updateVendorItemQty.js.map