"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJobVendorDeliveries = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
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
async function resolveLocationCodes(db, locationIds) {
    if (locationIds.length === 0)
        return [];
    const codes = [];
    for (const id of locationIds) {
        const snap = await db.collection("stagingLocations").doc(id).get();
        if (snap.exists) {
            const code = snap.data()?.code;
            if (typeof code === "string" && code.trim()) {
                codes.push(code.trim());
            }
        }
    }
    return codes;
}
function collectLocationIds(delivery) {
    const ids = (0, deliveryDetailsResponse_1.getAllStagingLocationIds)(delivery);
    const planned = delivery.plannedStagingLocationIds;
    if (Array.isArray(planned)) {
        for (const id of planned) {
            if (typeof id === "string" && id && !ids.includes(id))
                ids.push(id);
        }
    }
    return ids;
}
/** Post-PIN job-scoped delivery list — never cross-job (D14). */
exports.getJobVendorDeliveries = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const jobId = asJobId(data.jobId);
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (!jobId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await assertVendorSessionValidForJob(sessionToken, jobId);
    const db = getDb();
    const deliveriesSnap = await db
        .collection("deliveries")
        .where("jobId", "==", jobId)
        .limit(100)
        .get();
    const summaries = [];
    for (const docSnap of deliveriesSnap.docs) {
        const delivery = docSnap.data();
        const status = String(delivery.status ?? "");
        if (deliveryDetailsResponse_1.ZONE_CLEARED_DELIVERY_STATUSES.has(status))
            continue;
        if (deliveryDetailsResponse_1.RECEIVE_BLOCKED_DELIVERY_STATUSES.has(status))
            continue;
        const locationIds = collectLocationIds(delivery);
        const stagingLocationCodes = await resolveLocationCodes(db, locationIds);
        let poNumber;
        if (delivery.purchaseOrderId) {
            const poSnap = await db
                .collection("purchaseOrders")
                .doc(String(delivery.purchaseOrderId))
                .get();
            if (poSnap.exists) {
                const po = poSnap.data()?.poNumber;
                if (typeof po === "string")
                    poNumber = po;
            }
        }
        summaries.push({
            deliveryId: docSnap.id,
            orderNumber: String(delivery.orderNumber ?? docSnap.id),
            poNumber,
            vendorName: typeof delivery.vendorName === "string" && delivery.vendorName.trim()
                ? delivery.vendorName.trim()
                : "Vendor",
            status,
            stagingLocationCodes,
            scannedStagingLocationCode: session.scannedStagingLocationCode,
        });
    }
    summaries.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
    return {
        jobId,
        scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
        deliveries: summaries,
    };
});
async function assertVendorSessionValidForJob(sessionToken, jobId) {
    const snap = await getDb().collection("vendorSessions").doc(sessionToken).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const session = snap.data();
    if (session.jobId !== jobId) {
        throw new https_1.HttpsError("permission-denied", "Session is not valid for this job.");
    }
    const expiresMs = Date.parse(String(session.expiresAt ?? ""));
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    if (session.sessionScope === "delivery" && session.deliveryId) {
        await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, session.deliveryId);
    }
    return {
        scannedStagingLocationCode: typeof session.scannedStagingLocationCode === "string"
            ? session.scannedStagingLocationCode
            : undefined,
    };
}
//# sourceMappingURL=getJobVendorDeliveries.js.map