"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveVendorInvoiceImport = void 0;
/**
 * approveVendorInvoiceImport — approve/reject/reopen/create_shell/relink_to_shell.
 * Approve targets a server-resolved delivery: high-confidence matched existing (D-67)
 * or shell delivery-vii-{importId} (D-39 default). Client deliveryOrderId is confirm-only.
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const loadMatchContext_1 = require("./email/loadMatchContext");
const buildExpectedItemsFromImport_1 = require("./invoice/buildExpectedItemsFromImport");
const createDeliveryShellFromImport_1 = require("./invoice/createDeliveryShellFromImport");
const matchInvoiceToRecords_1 = require("./invoice/matchInvoiceToRecords");
const invoiceShellDisplayHelpers_1 = require("./invoice/invoiceShellDisplayHelpers");
const parsedHeaderValidation_1 = require("./invoice/parsedHeaderValidation");
const computeAutoImportEligibility_1 = require("./invoice/computeAutoImportEligibility");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const saveTrainingLessonCore_1 = require("./invoice/aiShadow/saveTrainingLessonCore");
const reopenIgnoreSkippedImport_1 = require("./invoice/aiShadow/reopenIgnoreSkippedImport");
const adminConfig_1 = require("./invoice/aiShadow/adminConfig");
const creditReturnSkip_1 = require("./invoice/creditReturnSkip");
const sharedStagingIdSanitize_1 = require("./invoice/fulfillmentOverride/sharedStagingIdSanitize");
const clearActiveStagingOnWillCall_1 = require("./invoice/clearActiveStagingOnWillCall");
const approveIdempotentReplay_1 = require("./invoice/approveIdempotentReplay");
const stagingOccupancyGuard_1 = require("./stagingOccupancyGuard");
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
function approvePlannedStagingPatch(stagingSkipped, ids) {
    // Will-Call clear is applied inside the transaction from live delivery data.
    if (stagingSkipped || ids.length === 0)
        return {};
    return { plannedStagingLocationIds: ids };
}
/** Clear active shop staging when CURRENT fulfillment skips shop staging. */
function willCallStagingClearPatchFromDelivery(existing, meta) {
    const clear = (0, clearActiveStagingOnWillCall_1.buildWillCallActiveStagingClearPatch)(existing ?? {}, meta);
    const patch = { ...clear.fields };
    if (clear.releaseEntries.length > 0) {
        patch.plannedLocationReleases = firestore_1.FieldValue.arrayUnion(...clear.releaseEntries);
    }
    return patch;
}
/** Only clear when post-write CURRENT skips shop staging (honors D-79 preserveOps). */
function activeStagingPatchForCurrentFulfillment(existing, fulfillmentPatch, dropOffStagingPatch, meta) {
    const effective = (0, clearActiveStagingOnWillCall_1.effectiveFulfillmentAfterPatch)(existing, fulfillmentPatch);
    const currentSkips = (0, invoiceShellDisplayHelpers_1.skipsShopStaging)({
        id: effective.id,
        vendorInvoiceImportId: effective.vendorInvoiceImportId,
        createdFromInvoiceImport: effective.createdFromInvoiceImport,
        invoiceFulfillmentMethod: effective.invoiceFulfillmentMethod,
        invoiceImportStatus: effective.invoiceImportStatus,
        invoiceDeliverToSite: effective.invoiceDeliverToSite,
    });
    if (currentSkips) {
        return willCallStagingClearPatchFromDelivery(existing, meta);
    }
    return dropOffStagingPatch;
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
    const plannedStagingLocationIds = (0, sharedStagingIdSanitize_1.sanitizePlannedStagingLocationIds)(data.plannedStagingLocationIds);
    let fulfillmentDecision;
    if (data.fulfillmentDecision !== undefined && data.fulfillmentDecision !== null) {
        if (action !== "approve") {
            // ignore for non-approve actions
        }
        else if (data.fulfillmentDecision !== "delivery" &&
            data.fulfillmentDecision !== "will_call_pickup") {
            throw new https_1.HttpsError("invalid-argument", "fulfillmentDecision must be delivery or will_call_pickup.");
        }
        else {
            fulfillmentDecision = data.fulfillmentDecision;
        }
    }
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
    if (action === "approve" && importDoc.reviewStatus === "approved") {
        const linkedId = importDoc.linkedDeliveryOrderId?.trim() ?? "";
        const deliverySnap = linkedId
            ? await getDb().collection("deliveries").doc(linkedId).get()
            : null;
        return (0, approveIdempotentReplay_1.resolveApproveIdempotentReplay)({
            importId,
            importDoc,
            clientDeliveryOrderId: deliveryOrderId,
            fulfillmentDecision,
            requestedPlannedIds: plannedStagingLocationIds,
            liveDelivery: deliverySnap?.exists
                ? deliverySnap.data()
                : null,
            deliveryExists: deliverySnap?.exists ?? false,
        });
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
                    const existingData = deliverySnap.data() ??
                        {};
                    const shellPatch = (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, importDoc, now, deliverySnap.data());
                    const stagingClear = activeStagingPatchForCurrentFulfillment(existingData, shellPatch, {}, { releasedBy: uid, releasedAt: now });
                    await deliveryRef.update({
                        ...shellPatch,
                        ...stagingClear,
                    });
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
                    const existingRecord = existingDelivery.data() ??
                        {};
                    const shellPatch = (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)(shell, importId, fresh, now, existingDelivery.data());
                    const stagingClear = activeStagingPatchForCurrentFulfillment(existingRecord, shellPatch, {}, { releasedBy: uid, releasedAt: now });
                    tx.update(deliveryRef, {
                        ...shellPatch,
                        ...stagingClear,
                    });
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
    // Approve — server-resolved target: matched existing delivery (D-67) or shell (D-39).
    if ((0, creditReturnSkip_1.creditReturnBlocksDeliveryCreation)(importDoc)) {
        throw new https_1.HttpsError("failed-precondition", creditReturnSkip_1.CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
    }
    const shell = await (0, createDeliveryShellFromImport_1.buildInvoiceDeliveryShellContext)(getDb(), importId, importDoc);
    const explicitApprovalOverride = fulfillmentDecision !== undefined;
    const effectiveFulfillment = fulfillmentDecision ?? shell.invoiceFulfillmentMethod;
    const effectiveDeliveryStatus = (fulfillmentDecision
        ? (0, invoiceShellDisplayHelpers_1.resolveShellDeliveryStatus)(importDoc.importStatus, fulfillmentDecision, shell.invoiceDeliverToSite)
        : shell.deliveryStatus);
    const effectiveShell = {
        ...shell,
        invoiceFulfillmentMethod: effectiveFulfillment,
        deliveryStatus: effectiveDeliveryStatus,
    };
    const header = (0, parsedHeaderValidation_1.asParsedHeaderForImport)(importDoc.parsedHeader);
    const matchCtx = await (0, loadMatchContext_1.loadEmailMatchContext)();
    const resolved = (0, createDeliveryShellFromImport_1.resolveInvoiceApproveDeliveryTarget)({
        importId,
        importDoc,
        header,
        ctx: matchCtx,
    });
    if (deliveryOrderId && deliveryOrderId !== resolved.targetDeliveryOrderId) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId does not match the server-resolved delivery target for this import.");
    }
    const targetId = resolved.targetDeliveryOrderId;
    const matchedExisting = resolved.matchedExisting;
    const shellId = resolved.shellId || (0, createDeliveryShellFromImport_1.shellDeliveryIdForImport)(importId);
    let matchedDeliveryData;
    if (matchedExisting) {
        const matchedSnap = await getDb().collection("deliveries").doc(targetId).get();
        if (!matchedSnap.exists) {
            throw new https_1.HttpsError("failed-precondition", "Matched delivery no longer exists. Refresh and try again.");
        }
        matchedDeliveryData = matchedSnap.data();
    }
    const targetJobId = matchedExisting
        ? String(matchedDeliveryData?.jobId ?? shell.jobId)
        : shell.jobId;
    const expectedItems = (0, buildExpectedItemsFromImport_1.buildExpectedItemsFromImport)(importId, targetId, targetJobId, importDoc.parsedLines ?? []);
    if (expectedItems.length === 0) {
        throw new https_1.HttpsError("failed-precondition", "No expected product lines to apply.");
    }
    const stagingSkipped = (0, invoiceShellDisplayHelpers_1.isInvoiceShellNoShopStaging)({
        createdFromInvoiceImport: true,
        invoiceImportStatus: importDoc.importStatus,
        invoiceFulfillmentMethod: effectiveShell.invoiceFulfillmentMethod,
        invoiceDeliverToSite: shell.invoiceDeliverToSite,
    });
    const existingPlanned = Array.isArray(matchedDeliveryData?.plannedStagingLocationIds)
        ? matchedDeliveryData.plannedStagingLocationIds.filter((id) => typeof id === "string" && id.trim().length > 0)
        : [];
    // Drop-Off: require selection unless matched delivery already has planned staging
    // and the client omitted ids (preserve). Explicit ids still replace.
    if (!stagingSkipped &&
        plannedStagingLocationIds.length === 0 &&
        !(matchedExisting && existingPlanned.length > 0)) {
        throw new https_1.HttpsError("failed-precondition", "Choose a staging location before approving this Vendor Drop-Off.");
    }
    const stagingPatch = approvePlannedStagingPatch(stagingSkipped, plannedStagingLocationIds);
    const deliveryRef = getDb().collection("deliveries").doc(targetId);
    const willCallClearMeta = {
        releasedBy: uid,
        releasedAt: now,
    };
    let idempotentReplayResult = null;
    let plannedStagingLocationCodes;
    await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
            throw new https_1.HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data();
        assertDeliveryAllowedForImport(fresh);
        if (fresh.reviewStatus === "approved") {
            const linkedId = fresh.linkedDeliveryOrderId?.trim() ?? "";
            const linkedRef = linkedId
                ? getDb().collection("deliveries").doc(linkedId)
                : deliveryRef;
            const replayDelivery = await tx.get(linkedRef);
            idempotentReplayResult = (0, approveIdempotentReplay_1.resolveApproveIdempotentReplay)({
                importId,
                importDoc: fresh,
                clientDeliveryOrderId: deliveryOrderId,
                fulfillmentDecision,
                requestedPlannedIds: plannedStagingLocationIds,
                liveDelivery: replayDelivery.exists
                    ? replayDelivery.data()
                    : null,
                deliveryExists: replayDelivery.exists,
            });
            return;
        }
        if (!canApproveReviewStatus(fresh.reviewStatus)) {
            throw new https_1.HttpsError("failed-precondition", `Import already ${fresh.reviewStatus}.`);
        }
        if (fresh.importStatus === "issue") {
            throw new https_1.HttpsError("failed-precondition", "Cannot approve — import has parse issues. Reject or wait for a valid invoice.");
        }
        const freshLinked = fresh.linkedDeliveryOrderId?.trim() ?? "";
        if (freshLinked && freshLinked !== targetId) {
            throw new https_1.HttpsError("failed-precondition", "Import was concurrently approved to a different delivery — reload and retry.");
        }
        const existingDelivery = await tx.get(deliveryRef);
        if (!stagingSkipped && plannedStagingLocationIds.length > 0) {
            const codes = [];
            for (const locId of plannedStagingLocationIds) {
                const { code } = await (0, stagingOccupancyGuard_1.assertStagingLocationAvailableInTransaction)(tx, getDb(), locId, targetId);
                codes.push(code);
            }
            plannedStagingLocationCodes = codes;
        }
        if (matchedExisting) {
            if (!existingDelivery.exists) {
                throw new https_1.HttpsError("failed-precondition", "Matched delivery no longer exists. Refresh and try again.");
            }
            // Re-check ownership at commit time (D-38) — pre-txn match snapshot can race.
            const liveDelivery = existingDelivery.data() ?? {};
            if (!(0, matchInvoiceToRecords_1.isDeliveryOwnedByImportOrUnclaimed)(liveDelivery, importId)) {
                throw new https_1.HttpsError("failed-precondition", "Matched delivery is already linked to another invoice import. Reload and try again.");
            }
            const matchedFulfillmentPatch = (0, createDeliveryShellFromImport_1.buildInvoiceMatchedDeliveryPatchDocument)(effectiveShell, importId, fresh, now, liveDelivery, explicitApprovalOverride);
            const activeStagingPatch = activeStagingPatchForCurrentFulfillment(liveDelivery, matchedFulfillmentPatch, stagingPatch, willCallClearMeta);
            tx.update(deliveryRef, {
                ...matchedFulfillmentPatch,
                ...activeStagingPatch,
            });
        }
        else if (!existingDelivery.exists) {
            // Shell path: create delivery-vii-{importId}.
            const shellForWrite = { ...effectiveShell, deliveryOrderId: shellId };
            const shellDoc = (0, createDeliveryShellFromImport_1.buildDeliveryShellDocument)(shellForWrite, importId, fresh, now);
            const activeStagingPatch = activeStagingPatchForCurrentFulfillment({}, shellDoc, stagingPatch, willCallClearMeta);
            tx.set(deliveryRef, {
                ...shellDoc,
                ...activeStagingPatch,
            });
        }
        else {
            const liveShellData = existingDelivery.data() ??
                {};
            const shellFulfillmentPatch = (0, createDeliveryShellFromImport_1.buildInvoiceShellPatchDocument)({ ...effectiveShell, deliveryOrderId: shellId }, importId, fresh, now, existingDelivery.data(), explicitApprovalOverride);
            const activeStagingPatch = activeStagingPatchForCurrentFulfillment(liveShellData, shellFulfillmentPatch, stagingPatch, willCallClearMeta);
            tx.update(deliveryRef, {
                ...shellFulfillmentPatch,
                ...activeStagingPatch,
            });
        }
        for (const item of expectedItems) {
            tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
        }
        tx.update(importRef, {
            reviewStatus: "approved",
            linkedDeliveryOrderId: targetId,
            approvedAt: now,
            approvedBy: uid,
            rejectedAt: firestore_1.FieldValue.delete(),
            rejectedBy: firestore_1.FieldValue.delete(),
            updatedAt: now,
            importDecisionLog: appendDecisionLogUpdate(fresh, (0, computeAutoImportEligibility_1.buildImportDecisionLogEntry)("approve", uid, now, eligibilityFromDoc(fresh), targetId, fulfillmentDecision
                ? {
                    fulfillmentDecision,
                    plannedStagingLocationIds: stagingSkipped
                        ? []
                        : (stagingPatch.plannedStagingLocationIds ?? plannedStagingLocationIds),
                }
                : undefined)),
        });
    });
    if (idempotentReplayResult) {
        return idempotentReplayResult;
    }
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
    const appliedPlanned = stagingSkipped
        ? []
        : (stagingPatch.plannedStagingLocationIds ??
            []);
    return {
        vendorInvoiceImportId: importId,
        reviewStatus: "approved",
        deliveryOrderId: targetId,
        itemsApplied: expectedItems.length,
        shellCreated: !matchedExisting,
        deliveryMatched: matchedExisting,
        jobCreated: matchedExisting ? false : shell.jobCreated,
        plannedStagingLocationIds: appliedPlanned,
        ...(plannedStagingLocationCodes
            ? { plannedStagingLocationCodes }
            : {}),
        trainingLessonWrote,
        trainingLessonPendingAdminReview,
        trainingLessonAlertEmailed,
    };
});
//# sourceMappingURL=approveVendorInvoiceImport.js.map