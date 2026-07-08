"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVendorStagingOccupancy = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function getDb() {
    return admin.firestore();
}
function denormalizedVendorName(delivery) {
    return typeof delivery.vendorName === "string" && delivery.vendorName.trim()
        ? delivery.vendorName.trim()
        : "Vendor";
}
/** Session-gated staging occupancy map for vendor Need More Space flows. */
exports.getVendorStagingOccupancy = (0, https_1.onCall)({
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
    const excludeDeliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.excludeDeliveryId) ?? deliveryId ?? undefined;
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const db = getDb();
    const sessionDeliverySnap = await db
        .collection("deliveries")
        .doc(deliveryId)
        .get();
    const sessionJobId = sessionDeliverySnap.exists
        ? String(sessionDeliverySnap.data()?.jobId ?? "")
        : "";
    const [locationsSnap, deliveriesSnap] = await Promise.all([
        db.collection("stagingLocations").limit(500).get(),
        db.collection("deliveries").limit(500).get(),
    ]);
    const locations = locationsSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        code: String(docSnap.data().code ?? docSnap.id),
    }));
    const byLocationId = {};
    for (const docSnap of deliveriesSnap.docs) {
        const delivery = docSnap.data();
        if (excludeDeliveryId && docSnap.id === excludeDeliveryId)
            continue;
        const status = delivery.status;
        if (deliveryDetailsResponse_1.ZONE_CLEARED_DELIVERY_STATUSES.has(status))
            continue;
        for (const locId of (0, deliveryDetailsResponse_1.getAllStagingLocationIds)(delivery)) {
            const location = locations.find((loc) => loc.id === locId);
            const isOwnJob = sessionJobId.length > 0 && String(delivery.jobId ?? "") === sessionJobId;
            const occupant = {
                deliveryId: docSnap.id,
                orderNumber: isOwnJob ? String(delivery.orderNumber ?? "") : "Occupied",
                vendorName: isOwnJob ? denormalizedVendorName(delivery) : "",
                locationId: locId,
                locationCode: location?.code ?? locId,
            };
            const existing = byLocationId[locId];
            if (!existing) {
                byLocationId[locId] = occupant;
                continue;
            }
            const prev = deliveriesSnap.docs.find((d) => d.id === existing.deliveryId);
            const prevUpdated = String(prev?.data().updatedAt ?? "");
            const candidateUpdated = String(delivery.updatedAt ?? "");
            if (candidateUpdated.localeCompare(prevUpdated) > 0) {
                byLocationId[locId] = occupant;
            }
        }
    }
    return { occupancy: byLocationId };
});
//# sourceMappingURL=getVendorStagingOccupancy.js.map