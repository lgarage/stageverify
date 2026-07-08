"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReceiveZoneLookup = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
function getDb() {
    return admin.firestore();
}
function asZoneCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
}
/** Pre-PIN zone routing — returns deliveryId only, no delivery/item hydration. */
exports.resolveReceiveZoneLookup = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const zoneCode = asZoneCode(request.data?.zoneCode);
    if (!zoneCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid zone code.");
    }
    const db = getDb();
    const locSnap = await db
        .collection("stagingLocations")
        .where("code", "==", zoneCode)
        .limit(1)
        .get();
    if (locSnap.empty) {
        return { found: false };
    }
    const locationId = locSnap.docs[0].id;
    const deliveriesSnap = await db.collection("deliveries").limit(500).get();
    const candidates = deliveriesSnap.docs.filter((docSnap) => {
        const delivery = docSnap.data();
        const status = delivery.status;
        if (deliveryDetailsResponse_1.ZONE_CLEARED_DELIVERY_STATUSES.has(status))
            return false;
        return (0, deliveryDetailsResponse_1.getAllStagingLocationIds)(delivery).includes(locationId);
    });
    if (candidates.length === 0) {
        return { found: false };
    }
    const sorted = [...candidates].sort((a, b) => {
        const aUpdated = String(a.data().updatedAt ?? "");
        const bUpdated = String(b.data().updatedAt ?? "");
        return bUpdated.localeCompare(aUpdated);
    });
    const chosen = sorted[0];
    const delivery = chosen.data();
    const deliveryId = chosen.id;
    const status = delivery.status;
    if (deliveryDetailsResponse_1.RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status)) {
        return {
            found: true,
            kind: "pickup",
            jobId: String(delivery.jobId ?? ""),
            deliveryId,
        };
    }
    return {
        found: true,
        kind: "receive",
        deliveryId,
    };
});
//# sourceMappingURL=resolveReceiveZoneLookup.js.map