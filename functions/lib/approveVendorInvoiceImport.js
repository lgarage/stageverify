"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveVendorInvoiceImport = void 0;
/**
 * approveVendorInvoiceImport — explicit approve/reject; writes expected items only.
 * Does NOT set qtyReceived, staging, or readiness.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const buildExpectedItemsFromImport_1 = require("./invoice/buildExpectedItemsFromImport");
const REVIEW_COLLECTION = "vendorInvoiceImports";
function getDb() {
    return admin.firestore();
}
function requireAuth(request) {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Sign in to approve invoice imports.");
    }
    return request.auth.uid;
}
exports.approveVendorInvoiceImport = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = requireAuth(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId = typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action !== "approve" && action !== "reject") {
        throw new https_1.HttpsError("invalid-argument", "action must be approve or reject.");
    }
    if (action === "approve" && (!deliveryOrderId || deliveryOrderId.length > 256)) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId is required to approve.");
    }
    const importRef = getDb().collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
    }
    const importDoc = importSnap.data();
    if (importDoc.reviewStatus !== "pending_review") {
        throw new https_1.HttpsError("failed-precondition", `Import already ${importDoc.reviewStatus}.`);
    }
    const now = new Date().toISOString();
    if (action === "reject") {
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (fresh.reviewStatus !== "pending_review") {
                throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
            }
            tx.update(importRef, {
                reviewStatus: "rejected",
                rejectedAt: now,
                rejectedBy: uid,
                updatedAt: now,
            });
        });
        return { vendorInvoiceImportId: importId, reviewStatus: "rejected" };
    }
    const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Target delivery not found.");
    }
    const delivery = deliverySnap.data();
    const jobId = typeof delivery.jobId === "string" ? delivery.jobId : "";
    if (!jobId) {
        throw new https_1.HttpsError("failed-precondition", "Delivery missing jobId.");
    }
    const header = importDoc.parsedHeader;
    const vendorInvoiceNumber = typeof header.vendorInvoiceNumber === "string" ? header.vendorInvoiceNumber : "";
    const vendorOrderNumber = typeof header.vendorOrderNumber === "string" ? header.vendorOrderNumber : "";
    const customerPo = typeof header.customerPoOrReference === "string"
        ? header.customerPoOrReference
        : "";
    const expectedItems = (0, buildExpectedItemsFromImport_1.buildExpectedItemsFromImport)(importId, deliveryOrderId, jobId, importDoc.parsedLines ?? []);
    if (expectedItems.length === 0) {
        throw new https_1.HttpsError("failed-precondition", "No expected product lines to apply.");
    }
    if (expectedItems.length > 200) {
        throw new https_1.HttpsError("failed-precondition", "Too many invoice lines to apply.");
    }
    const evidenceNote = `Imported from Johnstone invoice ${vendorInvoiceNumber || vendorOrderNumber} (Customer P/O: ${customerPo}). Review-only apply — no shop receipt.`;
    const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
    const notes = priorNotes.includes(evidenceNote)
        ? priorNotes
        : priorNotes
            ? `${priorNotes}\n${evidenceNote}`
            : evidenceNote;
    await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
            throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data();
        if (fresh.reviewStatus !== "pending_review") {
            throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
        }
        tx.update(importRef, {
            reviewStatus: "approved",
            linkedDeliveryOrderId: deliveryOrderId,
            approvedAt: now,
            approvedBy: uid,
            updatedAt: now,
        });
        tx.update(deliveryRef, {
            vendorInvoiceImportId: importId,
            invoiceImportStatus: importDoc.importStatus,
            ...(vendorInvoiceNumber ? { vendorInvoiceNumber } : {}),
            ...(vendorOrderNumber ? { vendorOrderNumber } : {}),
            ...(customerPo ? { customerPoOrReference: customerPo } : {}),
            notes,
            updatedAt: now,
        });
        for (const item of expectedItems) {
            tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
        }
    });
    return {
        vendorInvoiceImportId: importId,
        reviewStatus: "approved",
        deliveryOrderId,
        itemsApplied: expectedItems.length,
    };
});
//# sourceMappingURL=approveVendorInvoiceImport.js.map