"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOutboundEmailContext = loadOutboundEmailContext;
exports.loadReplyIngestSettings = loadReplyIngestSettings;
exports.isMessageEligibleForReplyIngest = isMessageEligibleForReplyIngest;
const admin = require("firebase-admin");
const MAX_OUTBOUND_EVENTS = 300;
function getDb() {
    return admin.firestore();
}
/** Load recent outbound vendorEmailEvents for thread/token matching. */
async function loadOutboundEmailContext() {
    const db = getDb();
    const snap = await db
        .collection("vendorEmailEvents")
        .orderBy("createdAt", "desc")
        .limit(MAX_OUTBOUND_EVENTS)
        .get();
    const out = [];
    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.direction !== "outbound")
            continue;
        out.push({
            eventId: doc.id,
            threadId: typeof data.threadId === "string" ? data.threadId : undefined,
            rfc822MessageId: typeof data.rfc822MessageId === "string" ? data.rfc822MessageId : undefined,
            trackingToken: typeof data.trackingToken === "string" ? data.trackingToken : undefined,
            deliveryOrderId: typeof data.deliveryOrderId === "string" ? data.deliveryOrderId : undefined,
            vendorInvoiceImportId: typeof data.vendorInvoiceImportId === "string"
                ? data.vendorInvoiceImportId
                : undefined,
            vendorId: typeof data.vendorId === "string" ? data.vendorId : undefined,
            jobId: typeof data.jobId === "string" ? data.jobId : undefined,
            purchaseOrderId: typeof data.purchaseOrderId === "string" ? data.purchaseOrderId : undefined,
        });
    }
    return out;
}
async function loadReplyIngestSettings() {
    const snap = await getDb().collection("appSettings").doc("config").get();
    const data = snap.data() ?? {};
    return {
        enabled: data.emailReplyIngestEnabled === true,
        since: typeof data.emailReplyIngestSince === "string" ? data.emailReplyIngestSince : null,
    };
}
function isMessageEligibleForReplyIngest(receivedAt, since) {
    if (!since)
        return true;
    return receivedAt >= since;
}
//# sourceMappingURL=loadOutboundEmailContext.js.map