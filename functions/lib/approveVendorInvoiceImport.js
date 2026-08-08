"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveVendorInvoiceImport = void 0;
/**
 * approveVendorInvoiceImport — approve/reject/reopen/create_shell/relink_to_shell.
 * Approve always creates dashboard shell delivery-vii-{importId} + expected items.
 * Link-to-existing was removed — use relink_to_shell to move a non-shell link onto its shell.
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const createDeliveryShellFromImport_1 = require("./invoice/createDeliveryShellFromImport");
const invoiceShellDisplayHelpers_1 = require("./invoice/invoiceShellDisplayHelpers");
const computeAutoImportEligibility_1 = require("./invoice/computeAutoImportEligibility");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const saveTrainingLessonCore_1 = require("./invoice/aiShadow/saveTrainingLessonCore");
const reopenIgnoreSkippedImport_1 = require("./invoice/aiShadow/reopenIgnoreSkippedImport");
const adminConfig_1 = require("./invoice/aiShadow/adminConfig");
const creditReturnSkip_1 = require("./invoice/creditReturnSkip");
const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_DECISION_LOG = 20;
function getDb() {
    return admin.firestore();
}
function canApproveReviewStatus(status) {
    return status === "pending_review" || status === "rejected";
}
/** Pending always; approved only when credit/return slipped into deliveries. */
function canRejectReviewStatus(doc) {
    if (doc.reviewStatus === "pending_review")
        return true;
    if (doc.reviewStatus === "approved" && (0, creditReturnSkip_1.isCreditReturnImportDoc)(doc))
        return true;
    return false;
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
        orderNotes: doc.orderNotes,
    });
}
function appendDecisionLogUpdate(doc, entry) {
    const prior = doc.importDecisionLog ?? [];
    return [...prior, entry].slice(-MAX_DECISION_LOG);
}
function assertDeliveryAllowedForImport(doc) {
    if ((0, creditReturnSkip_1.creditReturnBlocksDeliveryCreation)(doc)) {
        throw new https_1.HttpsError("failed-precondition", creditReturnSkip_1.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
    }
}
exports.approveVendorInvoiceImport = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const importId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId = typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";
    const correctionNoteRaw = typeof data.correctionNote === "string" ? data.correctionNote : "";
    if (!importId || importId.length > 256) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action === "link") {
        throw new https_1.HttpsError("invalid-argument", "Link removed — Approve creates a separate delivery for each invoice.");
    }
    if (action !== "approve" &&
        action !== "reject" &&
        action !== "reopen" &&
        action !== "create_shell" &&
        action !== "relink_to_shell") {
        throw new https_1.HttpsError("invalid-argument", "action must be approve, reject, reopen, create_shell, or relink_to_shell.");
    }
    if (action === "approve" && deliveryOrderId) {
        throw new https_1.HttpsError("invalid-argument", "Approve always creates a new delivery. Linking to an existing delivery was removed.");
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
        try {
            const result = await (0, reopenIgnoreSkippedImport_1.reopenVendorInvoiceImportCore)(getDb(), {
                importId,
                actorUid: uid,
                now,
            });
            if (!result.reopened && result.skipped) {
                throw new https_1.HttpsError("failed-precondition", result.reason === "already_pending"
                    ? "Import is already pending review."
                    : "Import cannot be reopened.");
            }
            return {
                vendorInvoiceImportId: importId,
                reviewStatus: "pending_review",
                ...(result.matchedRuleId ? { matchedRuleId: result.matchedRuleId } : {}),
                ...(result.reopenCount != null ? { reopenCount: result.reopenCount } : {}),
                ...(result.autoDisabled ? { ruleAutoDisabled: true } : {}),
            };
        }
        catch (err) {
            if (err instanceof https_1.HttpsError)
                throw err;
            if (err instanceof Error && err.message === "import_not_found") {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            if (err instanceof Error && err.message === "not_rejected") {
                throw new https_1.HttpsError("failed-precondition", `Import is not rejected; only rejected imports can be reopened.`);
            }
            if (err instanceof Error && err.message === "manual_reject_not_reopenable") {
                throw new https_1.HttpsError("failed-precondition", "This import was manually rejected and cannot be reopened. Only system auto-rejected imports (credit/return skip, document-ignore skip) support reopen.");
            }
            throw err;
        }
    }
    if (action === "reject" && !canRejectReviewStatus(importDoc)) {
        throw new https_1.HttpsError("failed-precondition", `Import already ${importDoc.reviewStatus}.`);
    }
    if (action === "approve" && !canApproveReviewStatus(importDoc.reviewStatus)) {
        throw new https_1.HttpsError("failed-precondition", `Import already ${importDoc.reviewStatus}.`);
    }
    if (action === "approve" && importDoc.importStatus === "issue") {
        throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
    }
    if (action === "approve" &&
        correctionNoteRaw.trim() &&
        importDoc.reviewStatus === "pending_review" &&
        (0, creditReturnSkip_1.shouldApplyNowDismissCreditImport)(correctionNoteRaw, importDoc)) {
        const vendorKey = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
        const lesson = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
            uid,
            vendorKey,
            correctionNoteRaw,
            importId,
            atIso: now,
        });
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (!canRejectReviewStatus(fresh)) {
                throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
            }
            tx.update(importRef, {
                reviewStatus: "rejected",
                skipReason: creditReturnSkip_1.CREDIT_RETURN_SKIP_REASON,
                rejectedAt: now,
                rejectedBy: uid,
                updatedAt: now,
                ...(lesson.trainingLessonWrote
                    ? { trainingLessonAppendedAt: now }
                    : {}),
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reject", uid, now, eligibilityFromDoc(fresh))),
            });
        });
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "rejected",
            importDismissed: true,
            trainingLessonWrote: lesson.trainingLessonWrote,
            trainingLessonPendingAdminReview: lesson.trainingLessonPendingAdminReview,
            trainingLessonAlertEmailed: lesson.trainingLessonAlertEmailed,
        };
    }
    if (action === "reject") {
        if (correctionNoteRaw.trim() &&
            (0, creditReturnSkip_1.shouldApplyNowDismissCreditImport)(correctionNoteRaw, importDoc)) {
            const vendorKey = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
            const lesson = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
                uid,
                vendorKey,
                correctionNoteRaw,
                importId,
                atIso: now,
            });
            await getDb().runTransaction(async (tx) => {
                const freshImport = await tx.get(importRef);
                if (!freshImport.exists) {
                    throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
                }
                const fresh = freshImport.data();
                if (!canRejectReviewStatus(fresh)) {
                    throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
                }
                tx.update(importRef, {
                    reviewStatus: "rejected",
                    skipReason: creditReturnSkip_1.CREDIT_RETURN_SKIP_REASON,
                    rejectedAt: now,
                    rejectedBy: uid,
                    updatedAt: now,
                    ...(lesson.trainingLessonWrote
                        ? { trainingLessonAppendedAt: now }
                        : {}),
                    importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reject", uid, now, eligibilityFromDoc(fresh))),
                });
            });
            return {
                vendorInvoiceImportId: importId,
                reviewStatus: "rejected",
                importDismissed: true,
                trainingLessonWrote: lesson.trainingLessonWrote,
                trainingLessonPendingAdminReview: lesson.trainingLessonPendingAdminReview,
                trainingLessonAlertEmailed: lesson.trainingLessonAlertEmailed,
            };
        }
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            if (!canRejectReviewStatus(fresh)) {
                throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
            }
            tx.update(importRef, {
                reviewStatus: "rejected",
                ...((0, creditReturnSkip_1.isCreditReturnImportDoc)(fresh)
                    ? { skipReason: creditReturnSkip_1.CREDIT_RETURN_SKIP_REASON }
                    : {}),
                rejectedAt: now,
                rejectedBy: uid,
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("reject", uid, now, eligibilityFromDoc(fresh))),
            });
        });
        let trainingLessonWrote = false;
        let trainingLessonPendingAdminReview = false;
        let trainingLessonAlertEmailed = false;
        if (correctionNoteRaw.trim()) {
            const vendorKey = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
            const lesson = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
                uid,
                vendorKey,
                correctionNoteRaw,
                importId,
                atIso: now,
            });
            trainingLessonWrote = lesson.trainingLessonWrote;
            trainingLessonPendingAdminReview = lesson.trainingLessonPendingAdminReview;
            trainingLessonAlertEmailed = lesson.trainingLessonAlertEmailed;
            if (lesson.trainingLessonWrote) {
                await importRef.update({
                    trainingLessonAppendedAt: now,
                    updatedAt: now,
                });
            }
        }
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "rejected",
            trainingLessonWrote,
            trainingLessonPendingAdminReview,
            trainingLessonAlertEmailed,
        };
    }
    if (action === "relink_to_shell") {
        if ((0, creditReturnSkip_1.creditReturnBlocksDeliveryCreation)(importDoc)) {
            throw new https_1.HttpsError("failed-precondition", creditReturnSkip_1.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
        }
        if (importDoc.reviewStatus !== "approved") {
            throw new https_1.HttpsError("failed-precondition", "Only approved imports can create a separate delivery.");
        }
        if (importDoc.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot create separate delivery — import has parse issues.");
        }
        const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
        const shellId = shell.deliveryOrderId;
        const priorLinkedId = importDoc.linkedDeliveryOrderId?.trim() ?? "";
        if (priorLinkedId === shellId) {
            const shellRef = getDb().collection("deliveries").doc(shellId);
            const shellSnap = await shellRef.get();
            if (!shellSnap.exists) {
                await shellRef.set((0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, importDoc, now));
                for (const item of shell.expectedItems) {
                    await getDb().collection("items").doc(item.id).set(item, { merge: true });
                }
            }
            else {
                await shellRef.update((0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, importDoc, now, shellSnap.data()));
                for (const item of shell.expectedItems) {
                    await getDb().collection("items").doc(item.id).set(item, { merge: true });
                }
            }
            return {
                vendorInvoiceImportId: importId,
                reviewStatus: "approved",
                deliveryOrderId: shellId,
                itemsApplied: shell.expectedItems.length,
                shellCreated: !shellSnap.exists,
                relinked: false,
            };
        }
        await getDb().runTransaction(async (tx) => {
            const freshImport = await tx.get(importRef);
            if (!freshImport.exists) {
                throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
            }
            const fresh = freshImport.data();
            assertDeliveryAllowedForImport(fresh);
            if (fresh.reviewStatus !== "approved") {
                throw new https_1.HttpsError("failed-precondition", "Only approved imports can create a separate delivery.");
            }
            if (fresh.importStatus === "issue") {
                throw new https_1.HttpsError("failed-precondition", "Cannot create separate delivery — import has parse issues.");
            }
            const freshLinked = fresh.linkedDeliveryOrderId?.trim() ?? "";
            if (freshLinked === shellId) {
                return;
            }
            const shellRef = getDb().collection("deliveries").doc(shellId);
            const oldRef = freshLinked && freshLinked !== shellId
                ? getDb().collection("deliveries").doc(freshLinked)
                : null;
            // All reads before writes (Firestore transaction rule).
            const shellSnap = await tx.get(shellRef);
            const oldSnap = oldRef ? await tx.get(oldRef) : null;
            if (!shellSnap.exists) {
                tx.set(shellRef, (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, fresh, now));
            }
            else {
                tx.update(shellRef, (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, fresh, now, shellSnap.data()));
            }
            for (const item of shell.expectedItems) {
                tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
            }
            if (oldRef && oldSnap?.exists) {
                const oldData = oldSnap.data();
                if (oldData.vendorInvoiceImportId?.trim() === importId) {
                    tx.update(oldRef, {
                        vendorInvoiceImportId: firestore_1.FieldValue.delete(),
                        updatedAt: now,
                    });
                }
            }
            tx.update(importRef, {
                linkedDeliveryOrderId: shellId,
                updatedAt: now,
                importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("relink_to_shell", uid, now, eligibilityFromDoc(fresh), shellId)),
            });
        });
        return {
            vendorInvoiceImportId: importId,
            reviewStatus: "approved",
            deliveryOrderId: shellId,
            itemsApplied: shell.expectedItems.length,
            shellCreated: true,
            relinked: priorLinkedId !== "" && priorLinkedId !== shellId,
        };
    }
    if (action === "create_shell") {
        if ((0, creditReturnSkip_1.creditReturnBlocksDeliveryCreation)(importDoc)) {
            throw new https_1.HttpsError("failed-precondition", creditReturnSkip_1.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
        }
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
                const missingStamp = !delivery.vendorInvoiceImportId?.trim();
                const isInvoiceShell = linkedId === shell.deliveryOrderId ||
                    delivery.createdFromInvoiceImport === true;
                if (isInvoiceShell) {
                    await deliveryRef.update((0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, importDoc, now, deliverySnap.data()));
                }
                else if (missingStamp) {
                    await deliveryRef.update({
                        vendorInvoiceImportId: importId,
                        invoiceImportStatus: importDoc.importStatus,
                        updatedAt: now,
                    });
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
            else if (linkedId === shell.deliveryOrderId) {
                await getDb().runTransaction(async (tx) => {
                    const existingDelivery = await tx.get(deliveryRef);
                    if (!existingDelivery.exists) {
                        tx.set(deliveryRef, (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, importDoc, now));
                        for (const item of shell.expectedItems) {
                            tx.set(getDb().collection("items").doc(item.id), item, {
                                merge: true,
                            });
                        }
                    }
                });
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
            assertDeliveryAllowedForImport(fresh);
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
                    tx.update(deliveryRef, (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, fresh, now, existingDelivery.data()));
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
    // Approve — always create/ensure this import's shell delivery.
    if ((0, creditReturnSkip_1.creditReturnBlocksDeliveryCreation)(importDoc)) {
        throw new https_1.HttpsError("failed-precondition", creditReturnSkip_1.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
    }
    const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
    const deliveryRef = getDb().collection("deliveries").doc(shell.deliveryOrderId);
    await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
            throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data();
        assertDeliveryAllowedForImport(fresh);
        if (!canApproveReviewStatus(fresh.reviewStatus)) {
            throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
        }
        if (fresh.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
        }
        const existingDelivery = await tx.get(deliveryRef);
        if (!existingDelivery.exists) {
            tx.set(deliveryRef, (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shell, importId, fresh, now));
        }
        else {
            tx.update(deliveryRef, (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, fresh, now, existingDelivery.data()));
        }
        for (const item of shell.expectedItems) {
            tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
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
    let trainingLessonWrote = false;
    let trainingLessonPendingAdminReview = false;
    let trainingLessonAlertEmailed = false;
    if (correctionNoteRaw.trim()) {
        const vendorKey = (0, adminConfig_1.vendorKeyFromImportDoc)(importDoc);
        const lesson = await (0, saveTrainingLessonCore_1.saveTrainingLessonCore)({
            uid,
            vendorKey,
            correctionNoteRaw,
            importId,
            atIso: now,
        });
        trainingLessonWrote = lesson.trainingLessonWrote;
        trainingLessonPendingAdminReview = lesson.trainingLessonPendingAdminReview;
        trainingLessonAlertEmailed = lesson.trainingLessonAlertEmailed;
        if (lesson.trainingLessonWrote) {
            await importRef.update({
                trainingLessonAppendedAt: now,
                updatedAt: now,
            });
        }
    }
    return {
        vendorInvoiceImportId: importId,
        reviewStatus: "approved",
        deliveryOrderId: shell.deliveryOrderId,
        itemsApplied: shell.expectedItems.length,
        shellCreated: true,
        jobCreated: shell.jobCreated,
        trainingLessonWrote,
        trainingLessonPendingAdminReview,
        trainingLessonAlertEmailed,
    };
});
//# sourceMappingURL=approveVendorInvoiceImport.js.map