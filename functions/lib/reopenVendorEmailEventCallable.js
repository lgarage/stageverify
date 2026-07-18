"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reopenVendorEmailEventCallable = void 0;
/**
 * Callable: reopen (undo dismiss) one rejected inbound vendorEmailEvent for Needs Review.
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function getDb() {
    return admin.firestore();
}
exports.reopenVendorEmailEventCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
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
        if (row.reviewStatus !== "rejected") {
            throw new https_1.HttpsError("failed-precondition", "Only rejected events can be reopened.");
        }
        const direction = row.direction ?? "inbound";
        if (direction !== "inbound") {
            throw new https_1.HttpsError("failed-precondition", "Only inbound events can be reopened in Needs Review.");
        }
        tx.update(ref, {
            reviewStatus: "pending_review",
            rejectedAt: firestore_1.FieldValue.delete(),
            rejectedBy: firestore_1.FieldValue.delete(),
            updatedAt: now,
        });
    });
    return {
        ok: true,
        vendorEmailEventId: eventId,
        reviewStatus: "pending_review",
    };
});
//# sourceMappingURL=reopenVendorEmailEventCallable.js.map