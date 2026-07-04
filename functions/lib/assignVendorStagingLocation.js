"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignVendorStagingLocation = void 0;
/**
 * Vendor staging assignment — session-gated replacement for unauth Firestore staging writes.
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
function asStagingLocationId(value) {
    if (value === null || value === "")
        return null;
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asAssignMode(value) {
    return value === "additional" ? "additional" : "primary";
}
function deliveryUsesStagingLocation(delivery, locationId) {
    if (delivery.stagingLocationId === locationId)
        return true;
    const extra = delivery.additionalStagingLocationIds;
    return Array.isArray(extra) && extra.includes(locationId);
}
async function assertStagingLocationAvailable(locationId, deliveryId) {
    const locSnap = await getDb().collection("stagingLocations").doc(locationId).get();
    if (!locSnap.exists) {
        throw new https_1.HttpsError("not-found", "Staging location not found.");
    }
    const occupiedSnap = await getDb()
        .collection("deliveries")
        .where("stagingLocationId", "==", locationId)
        .limit(5)
        .get();
    for (const doc of occupiedSnap.docs) {
        if (doc.id !== deliveryId) {
            throw new https_1.HttpsError("failed-precondition", "Staging location is occupied by another delivery.");
        }
    }
}
exports.assignVendorStagingLocation = (0, https_1.onCall)({
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
    const stagingLocationId = asStagingLocationId(data.stagingLocationId);
    const mode = asAssignMode(data.mode);
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    if (mode === "primary" && stagingLocationId === null && data.stagingLocationId !== null && data.stagingLocationId !== "") {
        throw new https_1.HttpsError("invalid-argument", "Invalid staging location.");
    }
    if (mode === "additional" && !stagingLocationId) {
        throw new https_1.HttpsError("invalid-argument", "stagingLocationId is required.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const delivery = deliverySnap.data();
    const status = delivery.status;
    if (status === "picked_up" || status === "installed") {
        throw new https_1.HttpsError("failed-precondition", "Delivery is no longer active.");
    }
    const now = new Date().toISOString();
    if (mode === "additional") {
        if (deliveryUsesStagingLocation(delivery, stagingLocationId)) {
            return { deliveryId, stagingLocationId, mode };
        }
        await assertStagingLocationAvailable(stagingLocationId, deliveryId);
        await deliveryRef.update({
            additionalStagingLocationIds: firestore_1.FieldValue.arrayUnion(stagingLocationId),
            updatedAt: now,
        });
        return { deliveryId, stagingLocationId, mode };
    }
    if (stagingLocationId) {
        if (!deliveryUsesStagingLocation(delivery, stagingLocationId)) {
            await assertStagingLocationAvailable(stagingLocationId, deliveryId);
        }
    }
    await deliveryRef.update({
        stagingLocationId: stagingLocationId ?? "",
        updatedAt: now,
    });
    return { deliveryId, stagingLocationId, mode };
});
//# sourceMappingURL=assignVendorStagingLocation.js.map