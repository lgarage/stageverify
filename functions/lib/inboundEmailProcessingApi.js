"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVendorInvoicePdf = exports.getVendorInvoiceImport = exports.listVendorInvoiceImports = exports.getInboundEmailProcessing = exports.listInboundEmailProcessing = void 0;
/**
 * Dispatcher inspect API for inbound email processing records.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const recoverStrandedProcessing_1 = require("./inboundEmail/recoverStrandedProcessing");
const sanitizeVendorInvoiceImport_1 = require("./inboundEmail/sanitizeVendorInvoiceImport");
const gmailApi_1 = require("./gmailApi");
const gmailInbound_1 = require("./gmailInbound");
const COLLECTION = "inboundEmailProcessing";
const IMPORTS_COLLECTION = "vendorInvoiceImports";
const MAX_LIST = 50;
const MAX_TEXT_PREVIEW = 4000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
function getDb() {
    return admin.firestore();
}
async function loadGmailRefreshToken() {
    const conn = await getDb().collection("emailProviderConnections").doc("gmail").get();
    if (!conn.exists) {
        throw new https_1.HttpsError("failed-precondition", "Gmail is not connected.");
    }
    const status = conn.data().status;
    if (status !== "connected") {
        throw new https_1.HttpsError("failed-precondition", "Gmail is not connected.");
    }
    const secretSnap = await getDb().collection("emailProviderSecrets").doc("gmail").get();
    if (!secretSnap.exists) {
        throw new https_1.HttpsError("failed-precondition", "Gmail credentials are missing.");
    }
    const refreshToken = secretSnap.data().refreshToken?.trim();
    if (!refreshToken) {
        throw new https_1.HttpsError("failed-precondition", "Gmail refresh token is missing.");
    }
    return refreshToken;
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
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
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
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
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
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
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
exports.getVendorInvoiceImport = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id || id.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "id is required.");
    }
    const snap = await getDb().collection(IMPORTS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
    }
    return (0, sanitizeVendorInvoiceImport_1.sanitizeVendorInvoiceImportForClient)(snap.data());
});
exports.getVendorInvoicePdf = (0, https_1.onCall)({
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: [gmailApi_1.gmailClientId, gmailApi_1.gmailClientSecret],
}, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    const importSnap = await getDb().collection(IMPORTS_COLLECTION).doc(importId).get();
    if (!importSnap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
    }
    const importDoc = importSnap.data();
    const inboundId = importDoc.inboundEmailProcessingId?.trim();
    if (!inboundId) {
        throw new https_1.HttpsError("failed-precondition", "Import has no inbound email record.");
    }
    const inboundSnap = await getDb().collection(COLLECTION).doc(inboundId).get();
    if (!inboundSnap.exists) {
        throw new https_1.HttpsError("not-found", "Inbound email processing record not found.");
    }
    const inbound = inboundSnap.data();
    const gmailMessageId = inbound.gmailMessageId?.trim();
    if (!gmailMessageId) {
        throw new https_1.HttpsError("failed-precondition", "Inbound email has no Gmail message id.");
    }
    const attachments = inbound.pdfAttachments ?? [];
    const pageIndex = importDoc.pageIndexInBatch ?? 0;
    const attachment = attachments[pageIndex] ??
        attachments.find((att) => !att.extractError) ??
        attachments[0];
    if (!attachment?.gmailAttachmentId) {
        throw new https_1.HttpsError("failed-precondition", "No PDF attachment metadata on this inbound email.");
    }
    const refreshToken = await loadGmailRefreshToken();
    const accessToken = await (0, gmailInbound_1.getGmailAccessTokenForProvider)(refreshToken);
    const bytes = await (0, gmailInbound_1.downloadGmailAttachment)(accessToken, gmailMessageId, attachment.gmailAttachmentId);
    if (bytes.length > MAX_PDF_BYTES) {
        throw new https_1.HttpsError("failed-precondition", "Invoice PDF exceeds maximum download size.");
    }
    return {
        filename: attachment.filename || "invoice.pdf",
        mimeType: attachment.mimeType || "application/pdf",
        sizeBytes: bytes.length,
        dataBase64: bytes.toString("base64"),
    };
});
//# sourceMappingURL=inboundEmailProcessingApi.js.map