"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordTechnicianJobOpen = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const deliveryReadiness_1 = require("./deliveryReadiness");
const technicianSessionValidation_1 = require("./technicianSessionValidation");
function getDb() {
    return admin.firestore();
}
const VALID_SOURCES = new Set(["location_scan", "pickup_deep_link"]);
function asJobId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (trimmed.length < 1 || trimmed.length > 128)
        return null;
    return trimmed;
}
function asClientOpenId(value) {
    if (typeof value !== "string")
        return null;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value))
        return null;
    return value;
}
function normalizeSource(value) {
    if (typeof value !== "string")
        return undefined;
    if (!VALID_SOURCES.has(value))
        return undefined;
    return value;
}
async function loadItemsForDelivery(deliveryId) {
    const itemsSnap = await getDb()
        .collection("items")
        .where("deliveryOrderId", "==", deliveryId)
        .limit(500)
        .get();
    return itemsSnap.docs.map((doc) => doc.data());
}
/** Records technician job open for ROI analytics (idempotent per clientOpenId). */
exports.recordTechnicianJobOpen = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, technicianSessionValidation_1.asTechnicianSessionToken)(data.sessionToken);
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const jobId = asJobId(data.jobId);
    if (!jobId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid job.");
    }
    const clientOpenId = asClientOpenId(data.clientOpenId);
    if (!clientOpenId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid client open id.");
    }
    const releaseDate = (0, technicianSessionValidation_1.todayReleaseDateUtc)();
    const session = await (0, technicianSessionValidation_1.assertTechnicianSessionForJobPickup)(sessionToken, jobId, releaseDate);
    const settingsSnap = await getDb()
        .collection("appSettings")
        .doc("config")
        .get();
    const vendorDeliveryMode = settingsSnap.data()?.vendorDeliveryMode ??
        "full_checkin";
    const now = new Date().toISOString();
    const deliveriesSnap = await getDb()
        .collection("deliveries")
        .where("jobId", "==", jobId)
        .limit(100)
        .get();
    let deliveryCount = 0;
    let readyForPickupCount = 0;
    for (const deliveryDoc of deliveriesSnap.docs) {
        deliveryCount += 1;
        const delivery = deliveryDoc.data();
        const items = await loadItemsForDelivery(deliveryDoc.id);
        const readiness = (0, deliveryReadiness_1.computeDeliveryReadiness)(delivery, items, now, vendorDeliveryMode);
        if (readiness.readyForPickup) {
            readyForPickupCount += 1;
        }
    }
    const eventId = `job-open-${clientOpenId}`;
    const source = normalizeSource(data.source);
    const eventDoc = {
        id: eventId,
        action: "TECH_JOB_OPENED",
        technicianId: session.technicianId,
        technicianName: session.technicianName,
        jobId,
        releaseDate,
        timestamp: now,
        createdAt: now,
        clientOpenId,
        readinessSnapshot: {
            deliveryCount,
            readyForPickupCount,
        },
    };
    if (session.scannedStagingLocationCode?.trim()) {
        eventDoc.scannedStagingLocationCode =
            session.scannedStagingLocationCode.trim();
    }
    if (source) {
        eventDoc.source = source;
    }
    const duplicate = await getDb().runTransaction(async (tx) => {
        const ref = getDb().collection("pinVerificationEvents").doc(eventId);
        const existing = await tx.get(ref);
        if (existing.exists) {
            return true;
        }
        tx.set(ref, eventDoc);
        return false;
    });
    return { duplicate };
});
//# sourceMappingURL=recordTechnicianJobOpen.js.map