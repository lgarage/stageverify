"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRANDED_PROCESSING_MS = void 0;
exports.recoverStrandedInboundProcessing = recoverStrandedInboundProcessing;
exports.recoverStrandedInboundProcessingList = recoverStrandedInboundProcessingList;
/**
 * Recover inboundEmailProcessing docs stuck in processingStatus=processing.
 *
 * TOCTOU guard: list/get may read a stale "processing" snapshot while parse completes
 * concurrently. The Firestore transaction re-reads the doc and only writes error when
 * processingStatus is still "processing" and updatedAt is still stranded.
 */
const admin = require("firebase-admin");
/** Minimum age before a processing record is considered stranded. */
exports.STRANDED_PROCESSING_MS = 10 * 60 * 1000;
function getDb() {
    return admin.firestore();
}
async function recoverStrandedInboundProcessing(doc) {
    if (doc.processingStatus !== "processing")
        return doc;
    const updatedMs = Date.parse(doc.updatedAt || doc.createdAt);
    if (Number.isNaN(updatedMs))
        return doc;
    if (Date.now() - updatedMs < exports.STRANDED_PROCESSING_MS)
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
        if (Number.isNaN(freshUpdatedMs) || Date.now() - freshUpdatedMs < exports.STRANDED_PROCESSING_MS) {
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