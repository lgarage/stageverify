/**
 * approveVendorInvoiceImport — approve/reject/reopen/create_shell/relink_to_shell.
 * Approve targets a server-resolved delivery: high-confidence matched existing (D-67)
 * or shell delivery-vii-{importId} (D-39 default). Client deliveryOrderId is confirm-only.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { loadEmailMatchContext } from "./email/loadMatchContext";
import { buildExpectedItemsFromImport } from "./invoice/buildExpectedItemsFromImport";
import {
  buildDeliveryShellDocument,
  buildInvoiceDeliveryShellContext,
  buildInvoiceMatchedDeliveryPatchDocument,
  buildInvoiceShellPatchDocument,
  resolveInvoiceApproveDeliveryTarget,
  shellDeliveryIdForImport,
} from "./invoice/createDeliveryShellFromImport";
import { isDeliveryOwnedByImportOrUnclaimed } from "./invoice/matchInvoiceToRecords";
import {
  isDeliveryOwnedForBusinessInvoiceApprove,
  resolveApproveBusinessInvoiceRedirect,
} from "./invoice/businessInvoiceIdentity";
import {
  isInvoiceShellNoShopStaging,
  jobNameFromInvoiceContext,
  resolveShellDeliveryStatus,
  skipsShopStaging,
} from "./invoice/invoiceShellDisplayHelpers";
import type { InvoiceFulfillmentMethod } from "./invoice/types";
import { asParsedHeaderForImport } from "./invoice/parsedHeaderValidation";
import {
  buildImportDecisionLogEntry,
  computeAutoImportEligibility,
  type ImportDecisionLogEntry,
} from "./invoice/computeAutoImportEligibility";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { saveTrainingLessonCore } from "./invoice/aiShadow/saveTrainingLessonCore";
import { reopenVendorInvoiceImportCore } from "./invoice/aiShadow/reopenIgnoreSkippedImport";
import { vendorKeyFromImportDoc } from "./invoice/aiShadow/adminConfig";
import {
  CREDIT_RETURN_SKIP_REASON,
  CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE,
  creditReturnBlocksDeliveryCreation,
  isCreditReturnImportDoc,
  shouldApplyNowDismissCreditImport,
} from "./invoice/creditReturnSkip";
import { sanitizePlannedStagingLocationIds } from "./invoice/fulfillmentOverride/sharedStagingIdSanitize";
import {
  buildWillCallActiveStagingClearPatch,
  effectiveFulfillmentAfterPatch,
} from "./invoice/clearActiveStagingOnWillCall";
import {
  resolveApproveIdempotentReplay,
  type ApproveFulfillmentDecision,
} from "./invoice/approveIdempotentReplay";
import { assertStagingLocationAvailableInTransaction } from "./stagingOccupancyGuard";

const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_DECISION_LOG = 20;

function getDb() {
  return admin.firestore();
}

function canApproveReviewStatus(status: VendorInvoiceImportDoc["reviewStatus"]): boolean {
  return status === "pending_review" || status === "rejected";
}

/** Pending always; approved only when credit/return slipped into deliveries. */
function canRejectReviewStatus(doc: VendorInvoiceImportDoc): boolean {
  if (doc.reviewStatus === "pending_review") return true;
  if (doc.reviewStatus === "approved" && isCreditReturnImportDoc(doc)) return true;
  return false;
}

function eligibilityFromDoc(doc: VendorInvoiceImportDoc) {
  return computeAutoImportEligibility({
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

function appendDecisionLogUpdate(
  doc: VendorInvoiceImportDoc,
  entry: ImportDecisionLogEntry,
): VendorInvoiceImportDoc["importDecisionLog"] {
  const prior = doc.importDecisionLog ?? [];
  return [...prior, entry].slice(-MAX_DECISION_LOG);
}

function assertDeliveryAllowedForImport(doc: VendorInvoiceImportDoc): void {
  if (creditReturnBlocksDeliveryCreation(doc)) {
    throw new HttpsError("failed-precondition", CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
  }
}

function approvePlannedStagingPatch(
  stagingSkipped: boolean,
  ids: string[],
): Record<string, unknown> {
  // Will-Call clear is applied inside the transaction from live delivery data.
  if (stagingSkipped || ids.length === 0) return {};
  return { plannedStagingLocationIds: ids };
}

/** Clear active shop staging when CURRENT fulfillment skips shop staging. */
function willCallStagingClearPatchFromDelivery(
  existing: Record<string, unknown> | undefined,
  meta: { releasedBy: string; releasedAt: string },
): Record<string, unknown> {
  const clear = buildWillCallActiveStagingClearPatch(existing ?? {}, meta);
  const patch: Record<string, unknown> = { ...clear.fields };
  if (clear.releaseEntries.length > 0) {
    patch.plannedLocationReleases = FieldValue.arrayUnion(
      ...clear.releaseEntries,
    );
  }
  return patch;
}

/** Only clear when post-write CURRENT skips shop staging (honors D-79 preserveOps). */
function activeStagingPatchForCurrentFulfillment(
  existing: Record<string, unknown> | undefined,
  fulfillmentPatch: Record<string, unknown>,
  dropOffStagingPatch: Record<string, unknown>,
  meta: { releasedBy: string; releasedAt: string },
): Record<string, unknown> {
  const effective = effectiveFulfillmentAfterPatch(existing, fulfillmentPatch);
  const currentSkips = skipsShopStaging({
    id: effective.id,
    vendorInvoiceImportId: effective.vendorInvoiceImportId,
    createdFromInvoiceImport: effective.createdFromInvoiceImport,
    invoiceFulfillmentMethod:
      effective.invoiceFulfillmentMethod as InvoiceFulfillmentMethod | undefined,
    invoiceImportStatus: effective.invoiceImportStatus,
    invoiceDeliverToSite: effective.invoiceDeliverToSite,
  });
  if (currentSkips) {
    return willCallStagingClearPatchFromDelivery(existing, meta);
  }
  return dropOffStagingPatch;
}

export const approveVendorInvoiceImport = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: string;
      action?: string;
      deliveryOrderId?: string;
      /** Generalized pattern note for vendor training MD — not invoice-specific details. */
      correctionNote?: string;
      /** Staging location doc ids — applied on approve for Vendor Drop-Off only. */
      plannedStagingLocationIds?: unknown;
      /** Explicit fulfillment choice on approve — delivery | will_call_pickup. */
      fulfillmentDecision?: unknown;
    };

    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId =
      typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";
    const correctionNoteRaw =
      typeof data.correctionNote === "string" ? data.correctionNote : "";
    const plannedStagingLocationIds = sanitizePlannedStagingLocationIds(
      data.plannedStagingLocationIds,
    );
    let fulfillmentDecision: ApproveFulfillmentDecision | undefined;
    if (data.fulfillmentDecision !== undefined && data.fulfillmentDecision !== null) {
      if (action !== "approve") {
        // ignore for non-approve actions
      } else if (
        data.fulfillmentDecision !== "delivery" &&
        data.fulfillmentDecision !== "will_call_pickup"
      ) {
        throw new HttpsError(
          "invalid-argument",
          "fulfillmentDecision must be delivery or will_call_pickup.",
        );
      } else {
        fulfillmentDecision = data.fulfillmentDecision;
      }
    }

    if (!importId || importId.length > 256) {
      throw new HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action === "link") {
      throw new HttpsError(
        "invalid-argument",
        "Link removed — Approve creates a separate delivery for each invoice.",
      );
    }
    if (
      action !== "approve" &&
      action !== "reject" &&
      action !== "reopen" &&
      action !== "create_shell" &&
      action !== "relink_to_shell"
    ) {
      throw new HttpsError(
        "invalid-argument",
        "action must be approve, reject, reopen, create_shell, or relink_to_shell.",
      );
    }
    const importRef = getDb().collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
      throw new HttpsError("not-found", "Vendor invoice import not found.");
    }

    const importDoc = importSnap.data() as VendorInvoiceImportDoc;
    const now = new Date().toISOString();

    if (action === "reopen") {
      if (importDoc.reviewStatus !== "rejected") {
        throw new HttpsError(
          "failed-precondition",
          `Import is ${importDoc.reviewStatus}; only rejected imports can be reopened.`,
        );
      }
      try {
        const result = await reopenVendorInvoiceImportCore(getDb(), {
          importId,
          actorUid: uid,
          now,
        });
        if (!result.reopened && result.skipped) {
          throw new HttpsError(
            "failed-precondition",
            result.reason === "already_pending"
              ? "Import is already pending review."
              : "Import cannot be reopened.",
          );
        }
        return {
          vendorInvoiceImportId: importId,
          reviewStatus: "pending_review" as const,
          ...(result.matchedRuleId ? { matchedRuleId: result.matchedRuleId } : {}),
          ...(result.reopenCount != null ? { reopenCount: result.reopenCount } : {}),
          ...(result.autoDisabled ? { ruleAutoDisabled: true } : {}),
        };
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err instanceof Error && err.message === "import_not_found") {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        if (err instanceof Error && err.message === "not_rejected") {
          throw new HttpsError(
            "failed-precondition",
            `Import is not rejected; only rejected imports can be reopened.`,
          );
        }
        if (err instanceof Error && err.message === "manual_reject_not_reopenable") {
          throw new HttpsError(
            "failed-precondition",
            "This import was manually rejected and cannot be reopened. Only system auto-rejected imports (credit/return skip, document-ignore skip) support reopen.",
          );
        }
        throw err;
      }
    }

    if (action === "reject" && !canRejectReviewStatus(importDoc)) {
      throw new HttpsError(
        "failed-precondition",
        `Import already ${importDoc.reviewStatus}.`,
      );
    }

    if (action === "approve" && importDoc.reviewStatus === "approved") {
      const linkedId = importDoc.linkedDeliveryOrderId?.trim() ?? "";
      const deliverySnap = linkedId
        ? await getDb().collection("deliveries").doc(linkedId).get()
        : null;
      return resolveApproveIdempotentReplay({
        importId,
        importDoc,
        clientDeliveryOrderId: deliveryOrderId,
        fulfillmentDecision,
        requestedPlannedIds: plannedStagingLocationIds,
        liveDelivery: deliverySnap?.exists
          ? (deliverySnap.data() as Record<string, unknown>)
          : null,
        deliveryExists: deliverySnap?.exists ?? false,
      });
    }

    if (action === "approve" && !canApproveReviewStatus(importDoc.reviewStatus)) {
      throw new HttpsError(
        "failed-precondition",
        `Import already ${importDoc.reviewStatus}.`,
      );
    }

    if (action === "approve" && importDoc.importStatus === "issue") {
      throw new HttpsError(
        "failed-precondition",
        "Cannot approve — import has parse issues. Reject or wait for a valid invoice.",
      );
    }

    if (
      action === "approve" &&
      correctionNoteRaw.trim() &&
      importDoc.reviewStatus === "pending_review" &&
      shouldApplyNowDismissCreditImport(correctionNoteRaw, importDoc)
    ) {
      const vendorKey = vendorKeyFromImportDoc(importDoc);
      const lesson = await saveTrainingLessonCore({
        uid,
        vendorKey,
        correctionNoteRaw,
        importId,
        atIso: now,
      });
      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        if (!canRejectReviewStatus(fresh)) {
          throw new HttpsError(
            "failed-precondition",
            `Import already ${fresh.reviewStatus}.`,
          );
        }
        tx.update(importRef, {
          reviewStatus: "rejected",
          skipReason: CREDIT_RETURN_SKIP_REASON,
          rejectedAt: now,
          rejectedBy: uid,
          updatedAt: now,
          ...(lesson.trainingLessonWrote
            ? { trainingLessonAppendedAt: now }
            : {}),
          importDecisionLog: appendDecisionLogUpdate(
            fresh,
            buildImportDecisionLogEntry("reject", uid, now, eligibilityFromDoc(fresh)),
          ),
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
      if (
        correctionNoteRaw.trim() &&
        shouldApplyNowDismissCreditImport(correctionNoteRaw, importDoc)
      ) {
        const vendorKey = vendorKeyFromImportDoc(importDoc);
        const lesson = await saveTrainingLessonCore({
          uid,
          vendorKey,
          correctionNoteRaw,
          importId,
          atIso: now,
        });
        await getDb().runTransaction(async (tx) => {
          const freshImport = await tx.get(importRef);
          if (!freshImport.exists) {
            throw new HttpsError("not-found", "Vendor invoice import not found.");
          }
          const fresh = freshImport.data() as VendorInvoiceImportDoc;
          if (!canRejectReviewStatus(fresh)) {
            throw new HttpsError(
              "failed-precondition",
              `Import already ${fresh.reviewStatus}.`,
            );
          }
          tx.update(importRef, {
            reviewStatus: "rejected",
            skipReason: CREDIT_RETURN_SKIP_REASON,
            rejectedAt: now,
            rejectedBy: uid,
            updatedAt: now,
            ...(lesson.trainingLessonWrote
              ? { trainingLessonAppendedAt: now }
              : {}),
            importDecisionLog: appendDecisionLogUpdate(
              fresh,
              buildImportDecisionLogEntry("reject", uid, now, eligibilityFromDoc(fresh)),
            ),
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
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        if (!canRejectReviewStatus(fresh)) {
          throw new HttpsError(
            "failed-precondition",
            `Import already ${fresh.reviewStatus}.`,
          );
        }
        tx.update(importRef, {
          reviewStatus: "rejected",
          ...(isCreditReturnImportDoc(fresh)
            ? { skipReason: CREDIT_RETURN_SKIP_REASON }
            : {}),
          rejectedAt: now,
          rejectedBy: uid,
          updatedAt: now,
          importDecisionLog: appendDecisionLogUpdate(
            fresh,
            buildImportDecisionLogEntry("reject", uid, now, eligibilityFromDoc(fresh)),
          ),
        });
      });

      let trainingLessonWrote = false;
      let trainingLessonPendingAdminReview = false;
      let trainingLessonAlertEmailed = false;
      if (correctionNoteRaw.trim()) {
        const vendorKey = vendorKeyFromImportDoc(importDoc);
        const lesson = await saveTrainingLessonCore({
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
      if (creditReturnBlocksDeliveryCreation(importDoc)) {
        throw new HttpsError("failed-precondition", CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
      }
      if (importDoc.reviewStatus !== "approved") {
        throw new HttpsError(
          "failed-precondition",
          "Only approved imports can create a separate delivery.",
        );
      }
      if (importDoc.importStatus === "issue") {
        throw new HttpsError(
          "failed-precondition",
          "Cannot create separate delivery — import has parse issues.",
        );
      }

      const shell = await buildInvoiceDeliveryShellContext(getDb(), importId, importDoc);
      const shellId = shell.deliveryOrderId;
      const priorLinkedId = importDoc.linkedDeliveryOrderId?.trim() ?? "";

      if (priorLinkedId === shellId) {
        const shellRef = getDb().collection("deliveries").doc(shellId);
        const shellSnap = await shellRef.get();
        if (!shellSnap.exists) {
          await shellRef.set(
            buildDeliveryShellDocument(shell, importId, importDoc, now),
          );
          for (const item of shell.expectedItems) {
            await getDb().collection("items").doc(item.id).set(item, { merge: true });
          }
        } else {
          await shellRef.update(
            buildInvoiceShellPatchDocument(
              shell,
              importId,
              importDoc,
              now,
              shellSnap.data(),
            ),
          );
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
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        assertDeliveryAllowedForImport(fresh);
        if (fresh.reviewStatus !== "approved") {
          throw new HttpsError(
            "failed-precondition",
            "Only approved imports can create a separate delivery.",
          );
        }
        if (fresh.importStatus === "issue") {
          throw new HttpsError(
            "failed-precondition",
            "Cannot create separate delivery — import has parse issues.",
          );
        }

        const freshLinked = fresh.linkedDeliveryOrderId?.trim() ?? "";
        if (freshLinked === shellId) {
          return;
        }

        const shellRef = getDb().collection("deliveries").doc(shellId);
        const oldRef =
          freshLinked && freshLinked !== shellId
            ? getDb().collection("deliveries").doc(freshLinked)
            : null;
        // All reads before writes (Firestore transaction rule).
        const shellSnap = await tx.get(shellRef);
        const oldSnap = oldRef ? await tx.get(oldRef) : null;

        if (!shellSnap.exists) {
          tx.set(shellRef, buildDeliveryShellDocument(shell, importId, fresh, now));
        } else {
          tx.update(
            shellRef,
            buildInvoiceShellPatchDocument(
              shell,
              importId,
              fresh,
              now,
              shellSnap.data(),
            ),
          );
        }
        for (const item of shell.expectedItems) {
          tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
        }

        if (oldRef && oldSnap?.exists) {
          const oldData = oldSnap.data() as { vendorInvoiceImportId?: string };
          if (oldData.vendorInvoiceImportId?.trim() === importId) {
            tx.update(oldRef, {
              vendorInvoiceImportId: FieldValue.delete(),
              updatedAt: now,
            });
          }
        }

        tx.update(importRef, {
          linkedDeliveryOrderId: shellId,
          updatedAt: now,
          importDecisionLog: appendDecisionLogUpdate(
            fresh,
            buildImportDecisionLogEntry(
              "relink_to_shell",
              uid,
              now,
              eligibilityFromDoc(fresh),
              shellId,
            ),
          ),
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
      if (creditReturnBlocksDeliveryCreation(importDoc)) {
        throw new HttpsError("failed-precondition", CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
      }
      const shellRedirect = await resolveApproveBusinessInvoiceRedirect(
        getDb(),
        importId,
        importDoc,
      );
      if (
        shellRedirect &&
        shellRedirect.canonicalImportId !== importId &&
        !shellRedirect.linkedDeliveryOrderId
      ) {
        throw new HttpsError(
          "failed-precondition",
          "This invoice is already tracked by another Invoice Review item — use that original delivery instead of create_shell.",
        );
      }
      if (
        shellRedirect?.linkedDeliveryOrderId &&
        !importDoc.linkedDeliveryOrderId?.trim()
      ) {
        await importRef.update({
          linkedDeliveryOrderId: shellRedirect.linkedDeliveryOrderId,
          canonicalImportId:
            importDoc.canonicalImportId ?? shellRedirect.canonicalImportId,
          updatedAt: now,
        });
        return {
          vendorInvoiceImportId: importId,
          reviewStatus: importDoc.reviewStatus,
          deliveryOrderId: shellRedirect.linkedDeliveryOrderId,
          itemsApplied: 0,
          shellCreated: false,
          linkedExistingBusinessInvoice: true,
        };
      }
      if (importDoc.reviewStatus !== "approved") {
        throw new HttpsError(
          "failed-precondition",
          "Only approved imports can create a dashboard record.",
        );
      }
      if (importDoc.linkedDeliveryOrderId?.trim()) {
        const linkedId = importDoc.linkedDeliveryOrderId.trim();
        const shell = await buildInvoiceDeliveryShellContext(getDb(), importId, importDoc);
        const deliveryRef = getDb().collection("deliveries").doc(linkedId);
        const deliverySnap = await deliveryRef.get();
        if (deliverySnap.exists) {
          const delivery = deliverySnap.data() as {
            createdFromInvoiceImport?: boolean;
            vendorInvoiceImportId?: string;
          };
          const existingOwner = delivery.vendorInvoiceImportId?.trim() ?? "";
          const canonicalOwner =
            (importDoc.canonicalImportId ?? shellRedirect?.canonicalImportId ?? "").trim();
          const preserveOtherOwner =
            Boolean(existingOwner) &&
            existingOwner !== importId &&
            (existingOwner === canonicalOwner ||
              (shellRedirect?.canonicalImportId === existingOwner &&
                shellRedirect.canonicalImportId !== importId));
          const missingStamp = !existingOwner;
          const isInvoiceShell =
            linkedId === shell.deliveryOrderId ||
            delivery.createdFromInvoiceImport === true;
          if (isInvoiceShell) {
            const existingData =
              (deliverySnap.data() as Record<string, unknown> | undefined) ??
              {};
            const shellPatch = buildInvoiceShellPatchDocument(
              shell,
              importId,
              importDoc,
              now,
              deliverySnap.data(),
            );
            if (preserveOtherOwner) {
              delete shellPatch.vendorInvoiceImportId;
            }
            const stagingClear = activeStagingPatchForCurrentFulfillment(
              existingData,
              shellPatch,
              {},
              { releasedBy: uid, releasedAt: now },
            );
            await deliveryRef.update({
              ...shellPatch,
              ...stagingClear,
            });
          } else if (missingStamp) {
            await deliveryRef.update({
              vendorInvoiceImportId: importId,
              invoiceImportStatus: importDoc.importStatus,
              updatedAt: now,
            });
          } else if (preserveOtherOwner) {
            // Already stamped by canonical sibling — do not steal ownership.
          } else if (existingOwner !== importId) {
            throw new HttpsError(
              "failed-precondition",
              "Linked delivery is already owned by another invoice import.",
            );
          }
          const jobSnap = await getDb().collection("jobs").doc(shell.jobId).get();
          const jobData = jobSnap.data();
          if (isInvoiceShell && jobData?.createdFromInvoiceImport === true) {
            const header = importDoc.parsedHeader as Record<string, unknown>;
            const orderNotes = importDoc.orderNotes ?? [];
            const po =
              typeof header.customerPoOrReference === "string"
                ? header.customerPoOrReference
                : "";
            const shipTo =
              typeof header.shipToName === "string" ? header.shipToName : undefined;
            const resolvedName = jobNameFromInvoiceContext(po, orderNotes, shipTo);
            if (resolvedName && jobData.jobName !== resolvedName) {
              await getDb().collection("jobs").doc(shell.jobId).update({
                jobName: resolvedName,
                updatedAt: now,
              });
            }
          }
        } else if (linkedId === shell.deliveryOrderId) {
          await getDb().runTransaction(async (tx) => {
            const existingDelivery = await tx.get(deliveryRef);
            if (!existingDelivery.exists) {
              tx.set(
                deliveryRef,
                buildDeliveryShellDocument(shell, importId, importDoc, now),
              );
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
        throw new HttpsError(
          "failed-precondition",
          "Cannot create dashboard record — import has parse issues.",
        );
      }

      const shell = await buildInvoiceDeliveryShellContext(getDb(), importId, importDoc);
      const deliveryRef = getDb().collection("deliveries").doc(shell.deliveryOrderId);

      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        assertDeliveryAllowedForImport(fresh);
        if (fresh.reviewStatus !== "approved") {
          throw new HttpsError(
            "failed-precondition",
            "Only approved imports can create a dashboard record.",
          );
        }
        if (fresh.linkedDeliveryOrderId?.trim()) {
          return;
        }
        if (fresh.importStatus === "issue") {
          throw new HttpsError(
            "failed-precondition",
            "Cannot create dashboard record — import has parse issues.",
          );
        }

        const existingDelivery = await tx.get(deliveryRef);
        if (!existingDelivery.exists) {
          tx.set(
            deliveryRef,
            buildDeliveryShellDocument(shell, importId, fresh, now),
          );
          for (const item of shell.expectedItems) {
            tx.set(getDb().collection("items").doc(item.id), item, { merge: true });
          }
        } else {
          const existingData = existingDelivery.data() as {
            createdFromInvoiceImport?: boolean;
          };
          if (existingData.createdFromInvoiceImport === true) {
            const existingRecord =
              (existingDelivery.data() as Record<string, unknown> | undefined) ??
              {};
            const shellPatch = buildInvoiceShellPatchDocument(
              shell,
              importId,
              fresh,
              now,
              existingDelivery.data(),
            );
            const stagingClear = activeStagingPatchForCurrentFulfillment(
              existingRecord,
              shellPatch,
              {},
              { releasedBy: uid, releasedAt: now },
            );
            tx.update(deliveryRef, {
              ...shellPatch,
              ...stagingClear,
            });
          }
        }

        tx.update(importRef, {
          linkedDeliveryOrderId: shell.deliveryOrderId,
          updatedAt: now,
          importDecisionLog: appendDecisionLogUpdate(
            fresh,
            buildImportDecisionLogEntry(
              "create_shell",
              uid,
              now,
              eligibilityFromDoc(fresh),
              shell.deliveryOrderId,
            ),
          ),
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
    if (creditReturnBlocksDeliveryCreation(importDoc)) {
      throw new HttpsError("failed-precondition", CREDIT_RETURN_DELIVERY_BLOCKED_MESSAGE);
    }

    const businessRedirect = await resolveApproveBusinessInvoiceRedirect(
      getDb(),
      importId,
      importDoc,
    );
    if (
      businessRedirect &&
      businessRedirect.canonicalImportId !== importId &&
      !businessRedirect.linkedDeliveryOrderId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This invoice is already tracked by another Invoice Review item — approve that original instead of creating a duplicate delivery.",
      );
    }
    const effectiveImportDoc: VendorInvoiceImportDoc =
      businessRedirect?.linkedDeliveryOrderId
        ? {
            ...importDoc,
            linkedDeliveryOrderId: businessRedirect.linkedDeliveryOrderId,
            canonicalImportId:
              importDoc.canonicalImportId ?? businessRedirect.canonicalImportId,
          }
        : businessRedirect?.canonicalImportId
          ? {
              ...importDoc,
              canonicalImportId:
                importDoc.canonicalImportId ?? businessRedirect.canonicalImportId,
            }
          : importDoc;
    const preserveCanonicalOwnerStamp = Boolean(
      businessRedirect?.linkedDeliveryOrderId &&
        businessRedirect.canonicalImportId &&
        businessRedirect.canonicalImportId !== importId,
    );

    const shell = await buildInvoiceDeliveryShellContext(
      getDb(),
      importId,
      effectiveImportDoc,
    );
    const explicitApprovalOverride = fulfillmentDecision !== undefined;
    const effectiveFulfillment =
      fulfillmentDecision ?? shell.invoiceFulfillmentMethod;
    const effectiveDeliveryStatus = (fulfillmentDecision
      ? resolveShellDeliveryStatus(
          effectiveImportDoc.importStatus,
          fulfillmentDecision,
          shell.invoiceDeliverToSite,
        )
      : shell.deliveryStatus) as typeof shell.deliveryStatus;
    const effectiveShell = {
      ...shell,
      invoiceFulfillmentMethod: effectiveFulfillment,
      deliveryStatus: effectiveDeliveryStatus,
    };
    const header = asParsedHeaderForImport(effectiveImportDoc.parsedHeader);
    const matchCtx = await loadEmailMatchContext();
    const resolved = resolveInvoiceApproveDeliveryTarget({
      importId,
      importDoc: effectiveImportDoc,
      header,
      ctx: matchCtx,
    });
    if (deliveryOrderId && deliveryOrderId !== resolved.targetDeliveryOrderId) {
      throw new HttpsError(
        "invalid-argument",
        "deliveryOrderId does not match the server-resolved delivery target for this import.",
      );
    }

    const targetId = resolved.targetDeliveryOrderId;
    const matchedExisting = resolved.matchedExisting;
    const shellId = resolved.shellId || shellDeliveryIdForImport(importId);
    const businessCanonicalId =
      effectiveImportDoc.canonicalImportId?.trim() ||
      businessRedirect?.canonicalImportId?.trim() ||
      "";

    let matchedDeliveryData: Record<string, unknown> | undefined;
    if (matchedExisting) {
      const matchedSnap = await getDb().collection("deliveries").doc(targetId).get();
      if (!matchedSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "Matched delivery no longer exists. Refresh and try again.",
        );
      }
      matchedDeliveryData = matchedSnap.data();
    }

    const targetJobId = matchedExisting
      ? String(matchedDeliveryData?.jobId ?? shell.jobId)
      : shell.jobId;
    const expectedItems = buildExpectedItemsFromImport(
      importId,
      targetId,
      targetJobId,
      importDoc.parsedLines ?? [],
    );
    if (expectedItems.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No expected product lines to apply.",
      );
    }

    const stagingSkipped = isInvoiceShellNoShopStaging({
      createdFromInvoiceImport: true,
      invoiceImportStatus: importDoc.importStatus,
      invoiceFulfillmentMethod: effectiveShell.invoiceFulfillmentMethod,
      invoiceDeliverToSite: shell.invoiceDeliverToSite,
    });
    const existingPlanned = Array.isArray(matchedDeliveryData?.plannedStagingLocationIds)
      ? (matchedDeliveryData!.plannedStagingLocationIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        )
      : [];
    // Drop-Off: require selection unless matched delivery already has planned staging
    // and the client omitted ids (preserve). Explicit ids still replace.
    if (
      !stagingSkipped &&
      plannedStagingLocationIds.length === 0 &&
      !(matchedExisting && existingPlanned.length > 0)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Choose a staging location before approving this Vendor Drop-Off.",
      );
    }
    const stagingPatch = approvePlannedStagingPatch(
      stagingSkipped,
      plannedStagingLocationIds,
    );

    const deliveryRef = getDb().collection("deliveries").doc(targetId);
    const willCallClearMeta = {
      releasedBy: uid,
      releasedAt: now,
    };

    let idempotentReplayResult: ReturnType<
      typeof resolveApproveIdempotentReplay
    > | null = null;
    let plannedStagingLocationCodes: string[] | undefined;

    await getDb().runTransaction(async (tx) => {
      const freshImport = await tx.get(importRef);
      if (!freshImport.exists) {
        throw new HttpsError("not-found", "Vendor invoice import not found.");
      }
      const fresh = freshImport.data() as VendorInvoiceImportDoc;
      assertDeliveryAllowedForImport(fresh);
      if (fresh.reviewStatus === "approved") {
        const linkedId = fresh.linkedDeliveryOrderId?.trim() ?? "";
        const linkedRef = linkedId
          ? getDb().collection("deliveries").doc(linkedId)
          : deliveryRef;
        const replayDelivery = await tx.get(linkedRef);
        idempotentReplayResult = resolveApproveIdempotentReplay({
          importId,
          importDoc: fresh,
          clientDeliveryOrderId: deliveryOrderId,
          fulfillmentDecision,
          requestedPlannedIds: plannedStagingLocationIds,
          liveDelivery: replayDelivery.exists
            ? (replayDelivery.data() as Record<string, unknown>)
            : null,
          deliveryExists: replayDelivery.exists,
        });
        return;
      }
      if (!canApproveReviewStatus(fresh.reviewStatus)) {
        throw new HttpsError(
          "failed-precondition",
          `Import already ${fresh.reviewStatus}.`,
        );
      }
      if (fresh.importStatus === "issue") {
        throw new HttpsError(
          "failed-precondition",
          "Cannot approve — import has parse issues. Reject or wait for a valid invoice.",
        );
      }

      const freshLinked = fresh.linkedDeliveryOrderId?.trim() ?? "";
      if (freshLinked && freshLinked !== targetId) {
        throw new HttpsError(
          "failed-precondition",
          "Import was concurrently approved to a different delivery — reload and retry.",
        );
      }

      const existingDelivery = await tx.get(deliveryRef);

      if (!stagingSkipped && plannedStagingLocationIds.length > 0) {
        const codes: string[] = [];
        for (const locId of plannedStagingLocationIds) {
          const { code } = await assertStagingLocationAvailableInTransaction(
            tx,
            getDb(),
            locId,
            targetId,
          );
          codes.push(code);
        }
        plannedStagingLocationCodes = codes;
      }

      if (matchedExisting) {
        if (!existingDelivery.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Matched delivery no longer exists. Refresh and try again.",
          );
        }
        // Re-check ownership at commit time (D-38) — pre-txn match snapshot can race.
        const liveDelivery = existingDelivery.data() ?? {};
        const owned =
          isDeliveryOwnedByImportOrUnclaimed(liveDelivery, importId) ||
          isDeliveryOwnedForBusinessInvoiceApprove(
            liveDelivery,
            importId,
            businessCanonicalId || fresh.canonicalImportId,
          );
        if (!owned) {
          throw new HttpsError(
            "failed-precondition",
            "Matched delivery is already linked to another invoice import. Reload and try again.",
          );
        }
        const matchedFulfillmentPatch = buildInvoiceMatchedDeliveryPatchDocument(
          effectiveShell,
          importId,
          fresh,
          now,
          liveDelivery,
          explicitApprovalOverride,
        );
        // Exact-resend / sibling approve must not steal D-67 ownership from canonical.
        if (
          preserveCanonicalOwnerStamp &&
          String(liveDelivery.vendorInvoiceImportId ?? "").trim() ===
            (businessCanonicalId || fresh.canonicalImportId || "").trim()
        ) {
          delete matchedFulfillmentPatch.vendorInvoiceImportId;
        }
        const activeStagingPatch = activeStagingPatchForCurrentFulfillment(
          liveDelivery as Record<string, unknown>,
          matchedFulfillmentPatch,
          stagingPatch,
          willCallClearMeta,
        );
        tx.update(deliveryRef, {
          ...matchedFulfillmentPatch,
          ...activeStagingPatch,
        });
      } else if (!existingDelivery.exists) {
        // Shell path: create delivery-vii-{importId}.
        const shellForWrite = { ...effectiveShell, deliveryOrderId: shellId };
        const shellDoc = buildDeliveryShellDocument(
          shellForWrite,
          importId,
          fresh,
          now,
        );
        const activeStagingPatch = activeStagingPatchForCurrentFulfillment(
          {},
          shellDoc,
          stagingPatch,
          willCallClearMeta,
        );
        tx.set(deliveryRef, {
          ...shellDoc,
          ...activeStagingPatch,
        });
      } else {
        const liveShellData =
          (existingDelivery.data() as Record<string, unknown> | undefined) ??
          {};
        const shellFulfillmentPatch = buildInvoiceShellPatchDocument(
          { ...effectiveShell, deliveryOrderId: shellId },
          importId,
          fresh,
          now,
          existingDelivery.data(),
          explicitApprovalOverride,
        );
        if (
          preserveCanonicalOwnerStamp &&
          String(
            (existingDelivery.data() as { vendorInvoiceImportId?: string } | undefined)
              ?.vendorInvoiceImportId ?? "",
          ).trim() === (businessCanonicalId || fresh.canonicalImportId || "").trim()
        ) {
          delete shellFulfillmentPatch.vendorInvoiceImportId;
        }
        const activeStagingPatch = activeStagingPatchForCurrentFulfillment(
          liveShellData,
          shellFulfillmentPatch,
          stagingPatch,
          willCallClearMeta,
        );
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
        rejectedAt: FieldValue.delete(),
        rejectedBy: FieldValue.delete(),
        updatedAt: now,
        importDecisionLog: appendDecisionLogUpdate(
          fresh,
          buildImportDecisionLogEntry(
            "approve",
            uid,
            now,
            eligibilityFromDoc(fresh),
            targetId,
            fulfillmentDecision
              ? {
                  fulfillmentDecision,
                  plannedStagingLocationIds: stagingSkipped
                    ? []
                    : ((stagingPatch.plannedStagingLocationIds as
                        | string[]
                        | undefined) ?? plannedStagingLocationIds),
                }
              : undefined,
          ),
        ),
      });
    });

    if (idempotentReplayResult) {
      return idempotentReplayResult;
    }

    let trainingLessonWrote = false;
    let trainingLessonPendingAdminReview = false;
    let trainingLessonAlertEmailed = false;
    if (correctionNoteRaw.trim()) {
      const vendorKey = vendorKeyFromImportDoc(importDoc);
      const lesson = await saveTrainingLessonCore({
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
      : ((stagingPatch.plannedStagingLocationIds as string[] | undefined) ??
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
  },
);
