"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchInvoiceToRecordsCallable = void 0;
/**
 * matchInvoiceToRecords — PO / sales order / job hint → candidate deliveries (read-only).
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const loadMatchContext_1 = require("./email/loadMatchContext");
const matchInvoiceToRecords_1 = require("./invoice/matchInvoiceToRecords");
const parsedHeaderValidation_1 = require("./invoice/parsedHeaderValidation");
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_NOTES_SCAN = 200;
function getDb() {
    return admin.firestore();
}
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
async function loadDeliveryNotes(deliveryIds) {
    const map = new Map();
    const db = getDb();
    const ids = deliveryIds.slice(0, MAX_NOTES_SCAN);
    await Promise.all(ids.map(async (id) => {
        const snap = await db.collection("deliveries").doc(id).get();
        if (!snap.exists)
            return;
        const notes = snap.data()?.notes;
        if (typeof notes === "string")
            map.set(id, notes);
    }));
    return map;
}
exports.matchInvoiceToRecordsCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    const snap = await getDb().collection(REVIEW_COLLECTION).doc(importId).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
    }
    const doc = snap.data();
    const header = (0, parsedHeaderValidation_1.asParsedHeaderForImport)(doc.parsedHeader);
    const ctx = await (0, loadMatchContext_1.loadEmailMatchContext)();
    const deliveryNotesById = await loadDeliveryNotes(ctx.deliveries.map((d) => d.id));
    const result = (0, matchInvoiceToRecords_1.matchInvoiceToRecords)(importId, header, ctx, deliveryNotesById);
    return {
        ...result,
        importStatus: doc.importStatus,
        reviewStatus: doc.reviewStatus,
    };
});
//# sourceMappingURL=matchInvoiceToRecordsCallable.js.map