"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getManagementWaitingParts = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const managementSessionValidation_1 = require("./managementSessionValidation");
const vendorDeliverySpotUtils_1 = require("./vendorDeliverySpotUtils");
function getDb() {
    return admin.firestore();
}
function uniqueSortedCodes(codes) {
    return [...new Set(codes.filter((c) => c.trim().length > 0))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
const WAITING_STATUSES = new Set(["pending", "shipped"]);
/** Jobs with expected deliveries not yet physically received (Phase 6 Slice A). */
exports.getManagementWaitingParts = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, managementSessionValidation_1.asManagementSessionToken)(data.sessionToken);
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, managementSessionValidation_1.assertManagementCatchAllSession)(sessionToken);
    const deliveriesSnap = await getDb()
        .collection("deliveries")
        .where("status", "in", ["pending", "shipped"])
        .limit(300)
        .get();
    const db = getDb();
    const byJob = new Map();
    for (const doc of deliveriesSnap.docs) {
        const delivery = doc.data();
        if (delivery.reviewFlag?.flagged === true)
            continue;
        if (doc.id.startsWith("delivery-unid-"))
            continue;
        if (delivery.vendorPhysicalDropoffConfirmed === true)
            continue;
        const status = delivery.status;
        if (!status || !WAITING_STATUSES.has(status))
            continue;
        const jobId = delivery.jobId?.trim();
        if (!jobId)
            continue;
        const locationIds = (0, vendorDeliverySpotUtils_1.collectLocationIds)(delivery);
        const stagingLocationCodes = await (0, vendorDeliverySpotUtils_1.resolveLocationCodes)(db, locationIds);
        const row = {
            deliveryId: doc.id,
            orderNumber: delivery.orderNumber?.trim() || doc.id,
            vendorName: delivery.vendorName?.trim() || "Vendor",
            poNumber: delivery.customerPoOrReference?.trim() || undefined,
            vendorInvoiceNumber: delivery.vendorInvoiceNumber?.trim() || undefined,
            status,
            stagingLocationCodes,
        };
        const list = byJob.get(jobId) ?? [];
        list.push(row);
        byJob.set(jobId, list);
    }
    const jobs = [];
    for (const [jobId, deliveries] of byJob.entries()) {
        const jobSnap = await db.collection("jobs").doc(jobId).get();
        const jobData = jobSnap.exists ? jobSnap.data() : {};
        if (jobData.status === "closed")
            continue;
        const jobName = jobData.jobName?.trim() || jobData.name?.trim() || jobId;
        const jobNumber = jobData.jobNumber?.trim() || undefined;
        deliveries.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }));
        const jobSpotCodes = uniqueSortedCodes(deliveries.flatMap((d) => d.stagingLocationCodes));
        jobs.push({
            jobId,
            jobNumber,
            jobName,
            stagingLocationCodes: jobSpotCodes,
            deliveries,
        });
    }
    jobs.sort((a, b) => a.jobName.localeCompare(b.jobName));
    return { jobs };
});
//# sourceMappingURL=getManagementWaitingParts.js.map