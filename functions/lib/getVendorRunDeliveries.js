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
function mapItems(itemsSnap) {
    return itemsSnap.docs.map((itemDoc) => {
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
            ...(typeof item.qtyReceived === "number"
                ? { qtyReceived: item.qtyReceived }
                : {}),
            ...(typeof item.qtyBackordered === "number"
                ? { qtyBackordered: item.qtyBackordered }
                : {}),
            ...(typeof item.status === "string" ? { status: item.status } : {}),
        };
    });
}
function chunkDeliveryIds(ids, chunkSize) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
        chunks.push(ids.slice(i, i + chunkSize));
    }
    return chunks;
}
function groupItemsByDeliveryId(itemSnaps) {
    const byDeliveryId = new Map();
    for (const snap of itemSnaps) {
        for (const itemDoc of snap.docs) {
            const deliveryOrderId = itemDoc.data().deliveryOrderId;
            if (typeof deliveryOrderId !== "string" || !deliveryOrderId) {
                continue;
            }
            const existing = byDeliveryId.get(deliveryOrderId) ?? [];
            if (existing.length < 50) {
                existing.push(itemDoc);
                byDeliveryId.set(deliveryOrderId, existing);
            }
        }
    }
    return byDeliveryId;
}
/** Vendor-scoped multi-job delivery list (opt-in company PIN — D-09 amended). */
exports.getVendorRunDeliveries = (0, https_1.onCall)({
    region: "us-central1",
    minInstances: 1,
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const timings = {};
    const tStart = Date.now();
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (!sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await assertVendorScopeSession(sessionToken);
    timings.sessionMs = Date.now() - tStart;
    const db = getDb();
    const tDeliveries = Date.now();
    const deliveriesSnap = await db
        .collection("deliveries")
        .where("vendorId", "==", session.vendorId)
        .limit(100)
        .get();
    timings.deliveriesQueryMs = Date.now() - tDeliveries;
    const activeDocs = deliveriesSnap.docs.filter((docSnap) => (0, vendorDeliverySpotUtils_1.isActiveVendorDelivery)(docSnap.data()));
    const jobIds = new Set();
    const poIds = new Set();
    const allLocationIds = [];
    for (const docSnap of activeDocs) {
        const delivery = docSnap.data();
        const jobId = String(delivery.jobId ?? "");
        if (jobId)
            jobIds.add(jobId);
        if (delivery.purchaseOrderId) {
            poIds.add(String(delivery.purchaseOrderId));
        }
        for (const id of (0, vendorDeliverySpotUtils_1.collectLocationIds)(delivery)) {
            allLocationIds.push(id);
        }
    }
    const tEnrich = Date.now();
    const jobRefs = [...jobIds].map((id) => db.collection("jobs").doc(id));
    const poRefs = [...poIds].map((id) => db.collection("purchaseOrders").doc(id));
    const deliveryIds = activeDocs.map((docSnap) => docSnap.id);
    const deliveryIdChunks = chunkDeliveryIds(deliveryIds, 30);
    const [jobSnaps, locationCodeMap, poSnaps, ...itemsChunkSnaps] = await Promise.all([
        jobRefs.length > 0 ? db.getAll(...jobRefs) : Promise.resolve([]),
        (0, vendorDeliverySpotUtils_1.resolveLocationCodesById)(db, allLocationIds),
        poRefs.length > 0 ? db.getAll(...poRefs) : Promise.resolve([]),
        ...deliveryIdChunks.map((chunk) => db
            .collection("items")
            .where("deliveryOrderId", "in", chunk)
            .get()),
    ]);
    timings.enrichmentMs = Date.now() - tEnrich;
    const itemsByDeliveryId = groupItemsByDeliveryId(itemsChunkSnaps);
    const jobNameById = new Map();
    for (const snap of jobSnaps) {
        if (snap.exists) {
            const jn = snap.data()?.jobName;
            if (typeof jn === "string" && jn.trim()) {
                jobNameById.set(snap.id, jn.trim());
            }
        }
    }
    const poNumberById = new Map();
    for (const snap of poSnaps) {
        if (snap.exists) {
            const po = snap.data()?.poNumber;
            if (typeof po === "string")
                poNumberById.set(snap.id, po);
        }
    }
    const summaries = activeDocs.map((docSnap) => {
        const delivery = docSnap.data();
        const deliveryId = docSnap.id;
        const jobId = String(delivery.jobId ?? "");
        const jobName = (jobId && jobNameById.get(jobId)) || "Job";
        const locationIds = (0, vendorDeliverySpotUtils_1.collectLocationIds)(delivery);
        const stagingLocationCodes = (0, vendorDeliverySpotUtils_1.locationCodesFromMap)(locationIds, locationCodeMap);
        let poNumber;
        if (delivery.purchaseOrderId) {
            const po = poNumberById.get(String(delivery.purchaseOrderId));
            if (po)
                poNumber = po;
        }
        const vendorInvoiceNumber = typeof delivery.vendorInvoiceNumber === "string" &&
            delivery.vendorInvoiceNumber.trim()
            ? delivery.vendorInvoiceNumber.trim()
            : undefined;
        const itemDocs = itemsByDeliveryId.get(deliveryId) ?? [];
        return {
            deliveryId,
            jobId,
            jobName,
            orderNumber: String(delivery.orderNumber ?? deliveryId),
            vendorInvoiceNumber,
            poNumber,
            ...(typeof delivery.status === "string"
                ? { status: delivery.status }
                : {}),
            stagingLocationCodes,
            hasAssignableSpot: (0, vendorDeliverySpotUtils_1.hasAssignableSpot)(delivery),
            vendorPhysicalDropoffConfirmed: delivery.vendorPhysicalDropoffConfirmed === true,
            items: mapItems({ docs: itemDocs }),
        };
    });
    summaries.sort((a, b) => {
        const jobCmp = a.jobName.localeCompare(b.jobName);
        if (jobCmp !== 0)
            return jobCmp;
        return a.orderNumber.localeCompare(b.orderNumber);
    });
    timings.totalMs = Date.now() - tStart;
    console.info("getVendorRunDeliveries timings", timings);
    return {
        vendorId: session.vendorId,
        scannedStagingLocationCode: session.scannedStagingLocationCode ?? null,
        deliveries: summaries,
    };
});
//# sourceMappingURL=getVendorRunDeliveries.js.map