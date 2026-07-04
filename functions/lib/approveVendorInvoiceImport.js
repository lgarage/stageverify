"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveVendorInvoiceImport = void 0;
/**
 * approveVendorInvoiceImport — explicit approve/reject/reopen.
 * Approve without deliveryOrderId: review-only (import reviewStatus approved; no delivery/items).
 * Approve with deliveryOrderId: writes expected items only; does NOT set qtyReceived, staging, or readiness.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const buildExpectedItemsFromImport_1 = require("./invoice/buildExpectedItemsFromImport");
const REVIEW_COLLECTION = "vendorInvoiceImports";
function getDb() {
    return admin.firestore();
}
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function canApproveReviewStatus(status) {
    return status === "pending_review" || status === "rejected";
}
exports.approveVendorInvoiceImport = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId = typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action !== "approve" && action !== "reject" && action !== "reopen") {
        throw new https_1.HttpsError("invalid-argument", "action must be approve, reject, or reopen.");
    }
    if (deliveryOrderId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId is too long.");
    }
    const importRef = getDb().collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
    }
    const importDoc = importSnap.data();
    const now = new Date().toISOString();
    if (action === "reopen") {
        if (importDoc.reviewStatus !== "rejected") {
            throw new https_1.HttpsError("failed-precondition", `Import is ${importDoc.reviewStatus}; only rejected imports can be reopened.`);
        }
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (fresh.reviewStatus !== "rejected") {
                throw new https_1.HttpsError("failed-precondition", `Import is ${fresh.reviewStatus}; only rejected imports can be reopened.`);
            }
            tx.update(importRef, {
                reviewStatus: "pending_review",
                rejectedAt: admin.firestore.FieldValue.delete(),
                rejectedBy: admin.firestore.FieldValue.delete(),
                updatedAt: now,
            });
        });
        return { vendorInvoiceImportId: importId, reviewStatus: "pending_review" };
    }
    if (action === "reject" && importDoc.reviewStatus !== "pending_review") {
        throw new https_1.HttpsError("failed-precondition", `Import already ${importDoc.reviewStatus}.`);
    }
    if (action === "approve" && !canApproveReviewStatus(importDoc.reviewStatus)) {
        throw new https_1.HttpsError("failed-precondition", `Import already ${importDoc.reviewStatus}.`);
    }
    if (action === "approve" && importDoc.importStatus === "issue") {
        throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
    }
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
    if (!deliveryOrderId) {
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (!canApproveReviewStatus(fresh.reviewStatus)) {
                throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
            }
            if (fresh.importStatus === "issue") {
                throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
            }
            tx.update(importRef, {
                reviewStatus: "approved",
                approvedAt: now,
                approvedBy: uid,
                rejectedAt: admin.firestore.FieldValue.delete(),
                rejectedBy: admin.firestore.FieldValue.delete(),
                updatedAt: now,
            });
        });
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "approved",
        };
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
        if (!canApproveReviewStatus(fresh.reviewStatus)) {
            throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
        }
        if (fresh.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
        }
        tx.update(importRef, {
            reviewStatus: "approved",
            linkedDeliveryOrderId: deliveryOrderId,
            approvedAt: now,
            approvedBy: uid,
            rejectedAt: admin.firestore.FieldValue.delete(),
            rejectedBy: admin.firestore.FieldValue.delete(),
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