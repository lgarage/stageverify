"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recoverStrandedInboundProcessing = recoverStrandedInboundProcessing;
exports.recoverStrandedInboundProcessingList = recoverStrandedInboundProcessingList;
/**
 * Recover inboundEmailProcessing docs stuck in processingStatus=processing.
 */
const admin = require("firebase-admin");
const STRANDED_PROCESSING_MS = 10 * 60 * 1000;
function getDb() {
    return admin.firestore();
}
async function recoverStrandedInboundProcessing(doc) {
    if (doc.processingStatus !== "processing")
        return doc;
    const updatedMs = Date.parse(doc.updatedAt || doc.createdAt);
    if (Number.isNaN(updatedMs))
        return doc;
    if (Date.now() - updatedMs < STRANDED_PROCESSING_MS)
        return doc;
    const ref = getDb().collection("inboundEmailProcessing").doc(doc.id);
    const now = new Date().toISOString();
    const patch = {
        processingStatus: "error",
        processingError: "Processing interrupted — retry inbound sync or inspect logs.",
        updatedAt: now,
    };
    await getDb().runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists)
            return;
        const data = fresh.data();
        if (data.processingStatus !== "processing")
            return;
        const freshUpdatedMs = Date.parse(data.updatedAt || data.createdAt);
        if (Number.isNaN(freshUpdatedMs) || Date.now() - freshUpdatedMs < STRANDED_PROCESSING_MS) {
            return;
        }
        tx.update(ref, patch);
    });
    const after = await ref.get();
    if (!after.exists)
        return doc;
    return after.data();
}
async function recoverStrandedInboundProcessingList(docs) {
    return Promise.all(docs.map((d) => recoverStrandedInboundProcessing(d)));
}
//# sourceMappingURL=recoverStrandedProcessing.js.map