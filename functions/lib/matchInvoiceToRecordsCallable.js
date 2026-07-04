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
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_NOTES_SCAN = 200;
function getDb() {
    return admin.firestore();
}
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function asParsedHeader(raw) {
    const str = (key, required = false) => {
        const v = raw[key];
        if (typeof v === "string" && v.trim())
            return v.trim();
        if (required)
            throw new https_1.HttpsError("failed-precondition", `Invoice header missing ${key}.`);
        return "";
    };
    return {
        customerAccountNumber: str("customerAccountNumber", true),
        vendorOrderNumber: str("vendorOrderNumber", true),
        vendorInvoiceNumber: str("vendorInvoiceNumber", true),
        customerPoOrReference: str("customerPoOrReference", true),
        quoteNumber: str("quoteNumber") || undefined,
        orderDate: str("orderDate", true),
        invoiceDate: str("invoiceDate"),
        shipDate: str("shipDate"),
        buyerName: str("buyerName") || undefined,
        shipViaRaw: str("shipViaRaw") || undefined,
        jobNumberRaw: str("jobNumberRaw") || undefined,
        vendorBranchName: str("vendorBranchName", true),
        vendorBranchAddress: str("vendorBranchAddress"),
        vendorBranchPhone: str("vendorBranchPhone"),
        soldToName: str("soldToName"),
        shipToName: str("shipToName"),
        shipToAddress: str("shipToAddress"),
        fulfillmentMethod: raw.fulfillmentMethod === "delivery" ||
            raw.fulfillmentMethod === "will_call_pickup" ||
            raw.fulfillmentMethod === "unknown"
            ? raw.fulfillmentMethod
            : "unknown",
        shipCompletePolicy: raw.shipCompletePolicy === "hold_until_complete" ||
            raw.shipCompletePolicy === "allow_partial" ||
            raw.shipCompletePolicy === "unknown"
            ? raw.shipCompletePolicy
            : "unknown",
    };
}
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
    const header = asParsedHeader(doc.parsedHeader);
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