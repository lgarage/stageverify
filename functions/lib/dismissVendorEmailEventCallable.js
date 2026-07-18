"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dismissVendorEmailEventCallable = void 0;
/**
 * Callable: dismiss (reject) one pending inbound vendorEmailEvent from Needs Review.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function getDb() {
    return admin.firestore();
}
exports.dismissVendorEmailEventCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const eventId = typeof data.vendorEmailEventId === "string"
        ? data.vendorEmailEventId.trim()
        : "";
    if (!eventId || eventId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorEmailEventId is required.");
    }
    const ref = getDb().collection("vendorEmailEvents").doc(eventId);
    const now = new Date().toISOString();
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Vendor email event not found.");
        }
        const row = snap.data();
        if (row.reviewStatus !== "pending_review") {
            throw new https_1.HttpsError("failed-precondition", "Only pending_review events can be dismissed.");
        }
        const direction = row.direction ?? "inbound";
        if (direction !== "inbound") {
            throw new https_1.HttpsError("failed-precondition", "Only inbound events can be dismissed from Needs Review.");
        }
        tx.update(ref, {
            reviewStatus: "rejected",
            rejectedAt: now,
            rejectedBy: uid,
            updatedAt: now,
        });
    });
    return {
        ok: true,
        vendorEmailEventId: eventId,
        reviewStatus: "rejected",
    };
});
//# sourceMappingURL=dismissVendorEmailEventCallable.js.map