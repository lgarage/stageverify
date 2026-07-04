"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEmailMatchContext = loadEmailMatchContext;
exports.loadExistingEmailIndex = loadExistingEmailIndex;
exports.resolveTargetDeliveryId = resolveTargetDeliveryId;
const admin = require("firebase-admin");
const MAX_MATCH_RECORDS = 500;
function getDb() {
    return admin.firestore();
}
/** Load matcher context from Firestore — bounded queries for CF ingestion. */
async function loadEmailMatchContext() {
    const db = getDb();
    const [vendorsSnap, jobsSnap, posSnap, deliveriesSnap] = await Promise.all([
        db.collection("vendors").limit(MAX_MATCH_RECORDS).get(),
        db.collection("jobs").limit(MAX_MATCH_RECORDS).get(),
        db.collection("purchaseOrders").limit(MAX_MATCH_RECORDS).get(),
        db.collection("deliveries").limit(MAX_MATCH_RECORDS).get(),
    ]);
    return {
        vendors: vendorsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                email: typeof data.email === "string" ? data.email : undefined,
            };
        }),
        jobs: jobsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                jobNumber: typeof data.jobNumber === "string" ? data.jobNumber : doc.id,
                jobName: typeof data.jobName === "string" ? data.jobName : undefined,
            };
        }),
        purchaseOrders: posSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                poNumber: typeof data.poNumber === "string" ? data.poNumber : doc.id,
                jobId: typeof data.jobId === "string" ? data.jobId : "",
                vendorId: typeof data.vendorId === "string" ? data.vendorId : "",
            };
        }),
        deliveries: deliveriesSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                orderNumber: typeof data.orderNumber === "string" ? data.orderNumber : doc.id,
                jobId: typeof data.jobId === "string" ? data.jobId : "",
                vendorId: typeof data.vendorId === "string" ? data.vendorId : "",
                purchaseOrderId: typeof data.purchaseOrderId === "string" ? data.purchaseOrderId : undefined,
            };
        }),
    };
}
async function loadExistingEmailIndex() {
    const db = getDb();
    const snap = await db.collection("vendorEmailEvents").limit(MAX_MATCH_RECORDS).get();
    const byMessageId = new Map();
    const byFingerprint = new Map();
    for (const doc of snap.docs) {
        const data = doc.data();
        const id = doc.id;
        if (typeof data.sourceMessageId === "string") {
            byMessageId.set(data.sourceMessageId, id);
        }
        if (typeof data.contentFingerprint === "string") {
            byFingerprint.set(data.contentFingerprint, id);
        }
    }
    return { byMessageId, byFingerprint };
}
function resolveTargetDeliveryId(match, ctx) {
    if (match.deliveryOrderId)
        return match.deliveryOrderId;
    if (!match.purchaseOrderId)
        return null;
    const candidates = ctx.deliveries.filter((d) => d.purchaseOrderId === match.purchaseOrderId);
    if (candidates.length === 1)
        return candidates[0].id;
    return null;
}
//# sourceMappingURL=loadMatchContext.js.map