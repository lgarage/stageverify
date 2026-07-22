"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPickupPortalData = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
const pickupAccessValidation_1 = require("./pickupAccessValidation");
function getDb() {
    return admin.firestore();
}
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
function asOptionalDeliveryId(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : undefined;
}
/** Token-gated pickup portal data — replaces public Firestore enumeration. */
exports.getPickupPortalData = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const token = (0, pickupTokenValidation_1.asPickupToken)(data.token);
    const jobId = asJobId(data.jobId);
    const includeDeliveryId = asOptionalDeliveryId(data.includeDeliveryId);
    if (!jobId || (!token && !data.technicianSessionToken)) {
        throw new https_1.HttpsError("invalid-argument", "Invalid pickup link.");
    }
    const db = getDb();
    await (0, pickupAccessValidation_1.assertPickupAccessForJob)(db, jobId, {
        pickupToken: token ?? undefined,
        technicianSessionToken: data.technicianSessionToken,
    });
    const deliveriesSnap = await db
        .collection("deliveries")
        .where("jobId", "==", jobId)
        .get();
    const visible = deliveriesSnap.docs.filter((docSnap) => {
        const status = docSnap.data().status;
        return (deliveryDetailsResponse_1.PICKUP_PORTAL_DELIVERY_STATUSES.includes(status) ||
            deliveryDetailsResponse_1.PICKUP_PORTAL_NOT_READY_DETAIL_STATUSES.includes(status) ||
            (includeDeliveryId !== undefined && docSnap.id === includeDeliveryId));
    });
    const deliveries = (await Promise.all(visible.map((docSnap) => (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(db, docSnap.id)))).filter((d) => d !== null);
    const stagingSnap = await db.collection("stagingLocations").limit(500).get();
    const stagingLocations = stagingSnap.docs.map((docSnap) => ({
        ...docSnap.data(),
        id: docSnap.id,
    }));
    return { deliveries, stagingLocations };
});
//# sourceMappingURL=getPickupPortalData.js.map