"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureUnidentifiableParcel = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const catchAllPendingCount_1 = require("./catchAllPendingCount");
const managementSessionValidation_1 = require("./managementSessionValidation");
function getDb() {
    return admin.firestore();
}
function asShortText(value, maxLen) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLen)
        return null;
    return trimmed;
}
function asOptionalJobId(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
/** Explicit capture → flagged shell; never auto-created from weak signals (Phase 6 Slice A). */
exports.captureUnidentifiableParcel = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, managementSessionValidation_1.asManagementSessionToken)(data.sessionToken);
    const vendorDescription = asShortText(data.vendorDescription, 128);
    const parcelDescription = asShortText(data.parcelDescription, 512);
    const jobId = asOptionalJobId(data.jobId);
    if (!sessionToken || !vendorDescription || !parcelDescription) {
        throw new https_1.HttpsError("invalid-argument", "Vendor and parcel description required.");
    }
    const session = await (0, managementSessionValidation_1.assertManagementCatchAllSession)(sessionToken);
    if (jobId) {
        const jobSnap = await getDb().collection("jobs").doc(jobId).get();
        if (!jobSnap.exists) {
            throw new https_1.HttpsError("not-found", "Job not found.");
        }
    }
    const now = new Date().toISOString();
    const deliveryId = `delivery-unid-${crypto.randomUUID().slice(0, 12)}`;
    const orderNumber = `UNID-${now.slice(0, 10).replace(/-/g, "")}-${deliveryId.slice(-6)}`;
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    await deliveryRef.set({
        id: deliveryId,
        orderNumber,
        ...(jobId ? { jobId } : {}),
        vendorId: "vendor-unknown",
        vendorName: vendorDescription,
        deliveryDate: now.slice(0, 10),
        status: "pending",
        availabilityStatus: "expected",
        stagingLocationId: session.scannedStagingLocationId,
        scannedStagingLocationId: session.scannedStagingLocationId,
        scannedAt: now,
        notes: parcelDescription,
        reviewFlag: {
            flagged: true,
            reason: "Unidentifiable parcel at catch-all intake",
            flaggedBy: "management",
            flaggedAt: now,
        },
        createdAt: now,
        updatedAt: now,
    });
    const logId = `catch-all-flag-${crypto.randomUUID().slice(0, 12)}`;
    await getDb().collection("pinVerificationEvents").doc(logId).set({
        id: logId,
        action: "CATCH_ALL_UNIDENTIFIABLE_PARCEL",
        deliveryId,
        timestamp: now,
        createdAt: now,
        stagingLocationCode: session.scannedStagingLocationCode,
    });
    await (0, catchAllPendingCount_1.decrementCatchAllPendingCount)(getDb());
    return {
        deliveryId,
        orderNumber,
        reviewFlagged: true,
    };
});
//# sourceMappingURL=captureUnidentifiableParcel.js.map