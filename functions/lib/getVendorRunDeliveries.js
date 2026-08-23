"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVendorRunDeliveries = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const vendorDeliverySpotUtils_1 = require("./vendorDeliverySpotUtils");
function getDb() {
    return admin.firestore();
}
async function assertVendorScopeSession(sessionToken) {
    const snap = await getDb().collection("vendorSessions").doc(sessionToken).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const session = snap.data();
    if (session.sessionScope !== "vendor" || !session.vendorId) {
        throw new https_1.HttpsError("permission-denied", "Session is not valid for vendor run.");
    }
    const expiresMs = Date.parse(String(session.expiresAt ?? ""));
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    return {
        vendorId: session.vendorId,
        scannedStagingLocationCode: typeof session.scannedStagingLocationCode === "string"
            ? session.scannedStagingLocationCode
            : undefined,
    };
}
/** Vendor-scoped multi-job delivery list (opt-in company PIN — D-09 amended). */
exports.getVendorRunDeliveries = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await assertVendorScopeSession(sessionToken);
    const db = getDb();
    const deliveriesSnap = await db
        .collection("deliveries")
        .where("vendorId", "==", session.vendorId)
        .limit(100)
        .get();
    const summaries = [];
    for (const docSnap of deliveriesSnap.docs) {
        const delivery = docSnap.data();
        if (!(0, vendorDeliverySpotUtils_1.isActiveVendorDelivery)(delivery))
            continue;
        const deliveryId = docSnap.id;
        const jobId = String(delivery.jobId ?? "");
        let jobName = "Job";
        if (jobId) {
            const jobSnap = await db.collection("jobs").doc(jobId).get();
            if (jobSnap.exists) {
                const jn = jobSnap.data()?.jobName;
                if (typeof jn === "string" && jn.trim())
                    jobName = jn.trim();
            }
        }
        const locationIds = (0, vendorDeliverySpotUtils_1.collectLocationIds)(delivery);
        const stagingLocationCodes = await (0, vendorDeliverySpotUtils_1.resolveLocationCodes)(db, locationIds);
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
        const itemsSnap = await db
            .collection("items")
            .where("deliveryOrderId", "==", deliveryId)
            .limit(50)
            .get();
        const items = itemsSnap.docs.map((itemDoc) => {
            const item = itemDoc.data();
            const description = typeof item.description === "string" && item.description.trim()
                ? item.description.trim()
                : typeof item.name === "string" && item.name.trim()
                    ? item.name.trim()
                    : "Item";
            return {
                id: itemDoc.id,
                description,
                qtyOrdered: typeof item.qtyOrdered === "number" ? item.qtyOrdered : 0,
            };
        });
        const vendorInvoiceNumber = typeof delivery.vendorInvoiceNumber === "string" &&
            delivery.vendorInvoiceNumber.trim()
            ? delivery.vendorInvoiceNumber.trim()
            : undefined;
        summaries.push({
            deliveryId,
            jobId,
            jobName,
            orderNumber: String(delivery.orderNumber ?? deliveryId),
            vendorInvoiceNumber,
            poNumber,
            stagingLocationCodes,
            hasAssignableSpot: (0, vendorDeliverySpotUtils_1.hasAssignableSpot)(delivery),
            vendorPhysicalDropoffConfirmed: delivery.vendorPhysicalDropoffConfirmed === true,
            items,
        });
    }
    summaries.sort((a, b) => {
        const jobCmp = a.jobName.localeCompare(b.jobName);
        if (jobCmp !== 0)
            return jobCmp;
        return a.orderNumber.localeCompare(b.orderNumber);
    });
    return {
        vendorId: session.vendorId,
        scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
        deliveries: summaries,
    };
});
//# sourceMappingURL=getVendorRunDeliveries.js.map