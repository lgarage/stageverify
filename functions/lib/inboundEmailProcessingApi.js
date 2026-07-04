"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVendorInvoiceImports = exports.getInboundEmailProcessing = exports.listInboundEmailProcessing = void 0;
/**
 * Dispatcher inspect API for inbound email processing records.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const recoverStrandedProcessing_1 = require("./inboundEmail/recoverStrandedProcessing");
const sanitizeVendorInvoiceImport_1 = require("./inboundEmail/sanitizeVendorInvoiceImport");
const COLLECTION = "inboundEmailProcessing";
const MAX_LIST = 50;
const MAX_TEXT_PREVIEW = 4000;
function getDb() {
    return admin.firestore();
}
function sanitizeDocForClient(doc) {
    const out = { ...doc };
    if (typeof out.combinedExtractedText === "string" &&
        out.combinedExtractedText.length > MAX_TEXT_PREVIEW) {
        out.combinedExtractedTextPreview = out.combinedExtractedText.slice(0, MAX_TEXT_PREVIEW);
        out.combinedExtractedTextTruncated = true;
        delete out.combinedExtractedText;
    }
    if (Array.isArray(out.pdfAttachments)) {
        out.pdfAttachments = out.pdfAttachments.map((att) => {
            const copy = { ...att };
            if (copy.extractedText && copy.extractedText.length > MAX_TEXT_PREVIEW) {
                copy.extractedText = `${copy.extractedText.slice(0, MAX_TEXT_PREVIEW)}…[truncated]`;
            }
            return copy;
        });
    }
    return out;
}
exports.listInboundEmailProcessing = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const limit = (0, dispatcherAuth_1.clampListLimit)(data.limit, 25, MAX_LIST);
    const snap = await getDb()
        .collection(COLLECTION)
        .orderBy("receivedAt", "desc")
        .limit(limit)
        .get();
    const raw = snap.docs.map((d) => d.data());
    const recovered = await (0, recoverStrandedProcessing_1.recoverStrandedInboundProcessingList)(raw);
    const items = recovered.map((d) => sanitizeDocForClient(d));
    return { items, count: items.length };
});
exports.getInboundEmailProcessing = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id || id.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "id is required.");
    }
    const snap = await getDb().collection(COLLECTION).doc(id).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Inbound email processing record not found.");
    }
    const [recovered] = await (0, recoverStrandedProcessing_1.recoverStrandedInboundProcessingList)([
        snap.data(),
    ]);
    return sanitizeDocForClient(recovered);
});
exports.listVendorInvoiceImports = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const inboundId = typeof data.inboundEmailProcessingId === "string"
        ? data.inboundEmailProcessingId.trim()
        : "";
    const limit = (0, dispatcherAuth_1.clampListLimit)(data.limit, 25, MAX_LIST);
    let query = getDb().collection("vendorInvoiceImports").orderBy("createdAt", "desc");
    if (inboundId) {
        query = query.where("inboundEmailProcessingId", "==", inboundId);
    }
    const snap = await query.limit(limit).get();
    const items = snap.docs.map((d) => (0, sanitizeVendorInvoiceImport_1.sanitizeVendorInvoiceImportForClient)(d.data()));
    return { items, count: items.length };
});
//# sourceMappingURL=inboundEmailProcessingApi.js.map