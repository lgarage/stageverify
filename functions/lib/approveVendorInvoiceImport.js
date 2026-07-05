"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveVendorInvoiceImport = void 0;
/**
 * approveVendorInvoiceImport — explicit approve/reject/reopen/link/create_shell.
 * Approve without deliveryOrderId: creates dashboard shell delivery + expected items.
 * Approve with deliveryOrderId: writes expected items only; does NOT set qtyReceived, staging, or readiness.
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const buildExpectedItemsFromImport_1 = require("./invoice/buildExpectedItemsFromImport");
const createDeliveryShellFromImport_1 = require("./invoice/createDeliveryShellFromImport");
const invoiceShellDisplayHelpers_1 = require("./invoice/invoiceShellDisplayHelpers");
const computeAutoImportEligibility_1 = require("./invoice/computeAutoImportEligibility");
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_DECISION_LOG = 20;
function getDb() {
    return admin.firestore();
}
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function canApproveReviewStatus(status) {
    return status === "pending_review" || status === "rejected";
}
function eligibilityFromDoc(doc) {
    return (0, computeAutoImportEligibility_1.computeAutoImportEligibility)({
        importStatus: doc.importStatus,
        confidenceScore: doc.confidenceScore,
        humanReviewRequired: doc.humanReviewRequired,
        duplicate: doc.duplicate,
        parseWarnings: doc.parseWarnings,
        parsedHeader: doc.parsedHeader,
        parsedLines: doc.parsedLines,
        parsedLineCount: doc.parsedLineCount,
        pageId: doc.pageId,
    });
}
function appendDecisionLogUpdate(doc, entry) {
    const prior = doc.importDecisionLog ?? [];
    return [...prior, entry].slice(-MAX_DECISION_LOG);
}
function buildDeliveryLinkContext(importDoc, importId, deliveryOrderId, jobId) {
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
    return {
        vendorInvoiceNumber,
        vendorOrderNumber,
        customerPo,
        expectedItems,
        evidenceNote,
    };
}
exports.approveVendorInvoiceImport = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId = typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action !== "approve" && action !== "reject" && action !== "reopen" && action !== "link" && action !== "create_shell") {
        throw new https_1.HttpsError("invalid-argument", "action must be approve, reject, reopen, link, or create_shell.");
    }
    if ((action === "approve" || action === "link") && deliveryOrderId.length > 256) {
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
                rejectedAt: firestore_1.FieldValue.delete(),
                rejectedBy: firestore_1.FieldValue.delete(),
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reopen", uid, now, eligibilityFromDoc(fresh))),
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
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reject", uid, now, eligibilityFromDoc(fresh))),
            });
        });
        return { vendorInvoiceImportId: importId, reviewStatus: "rejected" };
    }
    if (action === "link") {
        if (importDoc.reviewStatus !== "approved") {
            throw new https_1.HttpsError("failed-precondition", "Only approved imports can be linked to a delivery.");
        }
        if (importDoc.linkedDeliveryOrderId?.trim()) {
            throw new https_1.HttpsError("failed-precondition", "Import is already linked to a delivery.");
        }
        if (importDoc.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot link — import has parse issues.");
        }
        if (!deliveryOrderId) {
            throw new https_1.HttpsError("invalid-argument", "deliveryOrderId is required to link.");
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
        const linkContext = buildDeliveryLinkContext(importDoc, importId, deliveryOrderId, jobId);
        const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
        const notes = priorNotes.includes(linkContext.evidenceNote)
            ? priorNotes
            : priorNotes
                ? `${priorNotes}\n${linkContext.evidenceNote}`
                : linkContext.evidenceNote;
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (fresh.reviewStatus !== "approved") {
                throw new https_1.HttpsError("failed-precondition", "Only approved imports can be linked to a delivery.");
            }
            if (fresh.linkedDeliveryOrderId?.trim()) {
                throw new https_1.HttpsError("failed-precondition", "Import is already linked to a delivery.");
            }
            if (fresh.importStatus === "issue") {
                throw new https_1.HttpsError("failed-precondition", "Cannot link — import has parse issues.");
            }
            tx.update(importRef, {
                linkedDeliveryOrderId: deliveryOrderId,
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("link", uid, now, eligibilityFromDoc(fresh), deliveryOrderId)),
            });
            tx.update(deliveryRef, {
                vendorInvoiceImportId: importId,
                invoiceImportStatus: importDoc.importStatus,
                ...(linkContext.vendorInvoiceNumber
                    ? { vendorInvoiceNumber: linkContext.vendorInvoiceNumber }
                    : {}),
                ...(linkContext.vendorOrderNumber
                    ? { vendorOrderNumber: linkContext.vendorOrderNumber }
                    : {}),
                ...(linkContext.customerPo ? { customerPoOrReference: linkContext.customerPo } : {}),
                notes,
                updatedAt: now,
            });
            for (const item of linkContext.expectedItems) {
                tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
            }
        });
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "approved",
            deliveryOrderId,
            itemsApplied: linkContext.expectedItems.length,
        };
    }
    if (action === "create_shell") {
        if (importDoc.reviewStatus !== "approved") {
            throw new https_1.HttpsError("failed-precondition", "Only approved imports can create a dashboard record.");
        }
        if (importDoc.linkedDeliveryOrderId?.trim()) {
            const linkedId = importDoc.linkedDeliveryOrderId.trim();
            const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
            const deliveryRef = getDb().collection("deliveries").doc(linkedId);
            const deliverySnap = await deliveryRef.get();
            if (deliverySnap.exists) {
                const delivery = deliverySnap.data();
                const isInvoiceShell = linkedId === shell.deliveryOrderId ||
                    delivery.createdFromInvoiceImport === true;
                if (isInvoiceShell) {
                    await deliveryRef.update((0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, importDoc, now));
                }
                const jobSnap = await getDb().collection("jobs").doc(shell.jobId).get();
                const jobData = jobSnap.data();
                if (isInvoiceShell && jobData?.createdFromInvoiceImport === true) {
                    const header = importDoc.parsedHeader;
                    const orderNotes = importDoc.orderNotes ?? [];
                    const po = typeof header.customerPoOrReference === "string"
                        ? header.customerPoOrReference
                        : "";
                    const shipTo = typeof header.shipToName === "string" ? header.shipToName : undefined;
                    const resolvedName = (0, invoiceShellDisplayHelpers_1.jobNameFromInvoiceContext)(po, orderNotes, shipTo);
                    if (resolvedName && jobData.jobName !== resolvedName) {
                        await getDb().collection("jobs").doc(shell.jobId).update({
                            jobName: resolvedName,
                            updatedAt: now,
                        });
                    }
                }
            }
            return {
                vendorInvoiceImportId: importId,
                reviewStatus: "approved",
                deliveryOrderId: linkedId,
                itemsApplied: 0,
                shellCreated: false,
            };
        }
        if (importDoc.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot create dashboard record — import has parse issues.");
        }
        const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
        const deliveryRef = getDb().collection("deliveries").doc(shell.deliveryOrderId);
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (fresh.reviewStatus !== "approved") {
                throw new https_1.HttpsError("failed-precondition", "Only approved imports can create a dashboard record.");
            }
            if (fresh.linkedDeliveryOrderId?.trim()) {
                return;
            }
            if (fresh.importStatus === "issue") {
                throw new https_1.HttpsError("failed-precondition", "Cannot create dashboard record — import has parse issues.");
            }
            const existingDelivery = await tx.get(deliveryRef);
            if (!existingDelivery.exists) {
                tx.set(deliveryRef, (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, fresh, now));
                for (const item of shell.expectedItems) {
                    tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
                }
            }
            else {
                const existingData = existingDelivery.data();
                if (existingData.createdFromInvoiceImport === true) {
                    tx.update(deliveryRef, (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, fresh, now));
                }
            }
            tx.update(importRef, {
                linkedDeliveryOrderId: shell.deliveryOrderId,
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("create_shell", uid, now, eligibilityFromDoc(fresh), shell.deliveryOrderId)),
            });
        });
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "approved",
            deliveryOrderId: shell.deliveryOrderId,
            itemsApplied: shell.expectedItems.length,
            shellCreated: true,
            jobCreated: shell.jobCreated,
        };
    }
    if (!deliveryOrderId) {
        const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
        const deliveryRef = getDb().collection("deliveries").doc(shell.deliveryOrderId);
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
            const linkedId = fresh.linkedDeliveryOrderId?.trim();
            if (linkedId) {
                tx.update(importRef, {
                    reviewStatus: "approved",
                    approvedAt: now,
                    approvedBy: uid,
                    rejectedAt: firestore_1.FieldValue.delete(),
                    rejectedBy: firestore_1.FieldValue.delete(),
                    updatedAt: now,
                    importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("approve", uid, now, eligibilityFromDoc(fresh), linkedId)),
                });
                return;
            }
            const existingDelivery = await tx.get(deliveryRef);
            const shellWasNew = !existingDelivery.exists;
            if (shellWasNew) {
                tx.set(deliveryRef, (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, fresh, now));
                for (const item of shell.expectedItems) {
                    tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
                }
            }
            tx.update(importRef, {
                reviewStatus: "approved",
                linkedDeliveryOrderId: shell.deliveryOrderId,
                approvedAt: now,
                approvedBy: uid,
                rejectedAt: firestore_1.FieldValue.delete(),
                rejectedBy: firestore_1.FieldValue.delete(),
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("approve", uid, now, eligibilityFromDoc(fresh), shell.deliveryOrderId)),
            });
        });
        const linkedDeliveryOrderId = importDoc.linkedDeliveryOrderId?.trim() || shell.deliveryOrderId;
        const hadExistingLink = Boolean(importDoc.linkedDeliveryOrderId?.trim());
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "approved",
            deliveryOrderId: linkedDeliveryOrderId,
            itemsApplied: shell.expectedItems.length,
            shellCreated: !hadExistingLink,
            jobCreated: shell.jobCreated,
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
    const linkContext = buildDeliveryLinkContext(importDoc, importId, deliveryOrderId, jobId);
    const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
    const notes = priorNotes.includes(linkContext.evidenceNote)
        ? priorNotes
        : priorNotes
            ? `${priorNotes}\n${linkContext.evidenceNote}`
            : linkContext.evidenceNote;
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
            rejectedAt: firestore_1.FieldValue.delete(),
            rejectedBy: firestore_1.FieldValue.delete(),
            updatedAt: now,
            importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("approve", uid, now, eligibilityFromDoc(fresh), deliveryOrderId)),
        });
        tx.update(deliveryRef, {
            vendorInvoiceImportId: importId,
            invoiceImportStatus: importDoc.importStatus,
            ...(linkContext.vendorInvoiceNumber
                ? { vendorInvoiceNumber: linkContext.vendorInvoiceNumber }
                : {}),
            ...(linkContext.vendorOrderNumber
                ? { vendorOrderNumber: linkContext.vendorOrderNumber }
                : {}),
            ...(linkContext.customerPo ? { customerPoOrReference: linkContext.customerPo } : {}),
            notes,
            updatedAt: now,
        });
        for (const item of linkContext.expectedItems) {
            tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
        }
    });
    return {
        vendorInvoiceImportId: importId,
        reviewStatus: "approved",
        deliveryOrderId,
        itemsApplied: linkContext.expectedItems.length,
    };
});
//# sourceMappingURL=approveVendorInvoiceImport.js.map