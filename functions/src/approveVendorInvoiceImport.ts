/**
 * approveVendorInvoiceImport — explicit approve/reject/reopen.
 * Approve without deliveryOrderId: review-only (import reviewStatus approved; no delivery/items).
 * Approve with deliveryOrderId: writes expected items only; does NOT set qtyReceived, staging, or readiness.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { buildExpectedItemsFromImport } from "./invoice/buildExpectedItemsFromImport";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";

const REVIEW_COLLECTION = "vendorInvoiceImports";

function getDb() {
  return admin.firestore();
}

import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

function canApproveReviewStatus(status: VendorInvoiceImportDoc["reviewStatus"]): boolean {
  return status === "pending_review" || status === "rejected";
}

function buildDeliveryLinkContext(
  importDoc: VendorInvoiceImportDoc,
  importId: string,
  deliveryOrderId: string,
  jobId: string,
) {
  const header = importDoc.parsedHeader as Record<string, unknown>;
  const vendorInvoiceNumber =
    typeof header.vendorInvoiceNumber === "string" ? header.vendorInvoiceNumber : "";
  const vendorOrderNumber =
    typeof header.vendorOrderNumber === "string" ? header.vendorOrderNumber : "";
  const customerPo =
    typeof header.customerPoOrReference === "string"
      ? header.customerPoOrReference
      : "";

  const expectedItems = buildExpectedItemsFromImport(
    importId,
    deliveryOrderId,
    jobId,
    importDoc.parsedLines ?? [],
  );

  if (expectedItems.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "No expected product lines to apply.",
    );
  }

  if (expectedItems.length > 200) {
    throw new HttpsError("failed-precondition", "Too many invoice lines to apply.");
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

export const approveVendorInvoiceImport = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as {
      vendorInvoiceImportId?: string;
      action?: string;
      deliveryOrderId?: string;
    };

    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    const deliveryOrderId =
      typeof data.deliveryOrderId === "string" ? data.deliveryOrderId.trim() : "";

    if (!importId || importId.length > 256) {
      throw new HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (action !== "approve" && action !== "reject" && action !== "reopen" && action !== "link") {
      throw new HttpsError(
        "invalid-argument",
        "action must be approve, reject, reopen, or link.",
      );
    }
    if ((action === "approve" || action === "link") && deliveryOrderId.length > 256) {
      throw new HttpsError("invalid-argument", "deliveryOrderId is too long.");
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
      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "rejected") {
          throw new HttpsError(
            "failed-precondition",
            `Import is ${fresh.reviewStatus}; only rejected imports can be reopened.`,
          );
        }
        tx.update(importRef, {
          reviewStatus: "pending_review",
          rejectedAt: FieldValue.delete(),
          rejectedBy: FieldValue.delete(),
          updatedAt: now,
        });
      });
      return { vendorInvoiceImportId: importId, reviewStatus: "pending_review" };
    }

    if (action === "reject" && importDoc.reviewStatus !== "pending_review") {
      throw new HttpsError(
        "failed-precondition",
        `Import already ${importDoc.reviewStatus}.`,
      );
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

    if (action === "reject") {
      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "pending_review") {
          throw new HttpsError(
            "failed-precondition",
            `Import already ${fresh.reviewStatus}.`,
          );
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

    if (action === "link") {
      if (importDoc.reviewStatus !== "approved") {
        throw new HttpsError(
          "failed-precondition",
          "Only approved imports can be linked to a delivery.",
        );
      }
      if (importDoc.linkedDeliveryOrderId?.trim()) {
        throw new HttpsError(
          "failed-precondition",
          "Import is already linked to a delivery.",
        );
      }
      if (importDoc.importStatus === "issue") {
        throw new HttpsError(
          "failed-precondition",
          "Cannot link — import has parse issues.",
        );
      }
      if (!deliveryOrderId) {
        throw new HttpsError("invalid-argument", "deliveryOrderId is required to link.");
      }

      const deliveryRef = getDb().collection("deliveries").doc(deliveryOrderId);
      const deliverySnap = await deliveryRef.get();
      if (!deliverySnap.exists) {
        throw new HttpsError("not-found", "Target delivery not found.");
      }

      const delivery = deliverySnap.data() as { jobId?: string; notes?: string };
      const jobId = typeof delivery.jobId === "string" ? delivery.jobId : "";
      if (!jobId) {
        throw new HttpsError("failed-precondition", "Delivery missing jobId.");
      }

      const linkContext = buildDeliveryLinkContext(
        importDoc,
        importId,
        deliveryOrderId,
        jobId,
      );
      const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
      const notes = priorNotes.includes(linkContext.evidenceNote)
        ? priorNotes
        : priorNotes
          ? `${priorNotes}\n${linkContext.evidenceNote}`
          : linkContext.evidenceNote;

      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
        if (fresh.reviewStatus !== "approved") {
          throw new HttpsError(
            "failed-precondition",
            "Only approved imports can be linked to a delivery.",
          );
        }
        if (fresh.linkedDeliveryOrderId?.trim()) {
          throw new HttpsError(
            "failed-precondition",
            "Import is already linked to a delivery.",
          );
        }
        if (fresh.importStatus === "issue") {
          throw new HttpsError(
            "failed-precondition",
            "Cannot link — import has parse issues.",
          );
        }

        tx.update(importRef, {
          linkedDeliveryOrderId: deliveryOrderId,
          updatedAt: now,
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

    if (!deliveryOrderId) {
      await getDb().runTransaction(async (tx) => {
        const freshImport = await tx.get(importRef);
        if (!freshImport.exists) {
          throw new HttpsError("not-found", "Vendor invoice import not found.");
        }
        const fresh = freshImport.data() as VendorInvoiceImportDoc;
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
        tx.update(importRef, {
          reviewStatus: "approved",
          approvedAt: now,
          approvedBy: uid,
          rejectedAt: FieldValue.delete(),
          rejectedBy: FieldValue.delete(),
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
      throw new HttpsError("not-found", "Target delivery not found.");
    }

    const delivery = deliverySnap.data() as {
      jobId?: string;
      notes?: string;
    };
    const jobId = typeof delivery.jobId === "string" ? delivery.jobId : "";
    if (!jobId) {
      throw new HttpsError("failed-precondition", "Delivery missing jobId.");
    }

    const linkContext = buildDeliveryLinkContext(
      importDoc,
      importId,
      deliveryOrderId,
      jobId,
    );
    const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
    const notes = priorNotes.includes(linkContext.evidenceNote)
      ? priorNotes
      : priorNotes
        ? `${priorNotes}\n${linkContext.evidenceNote}`
        : linkContext.evidenceNote;

    await getDb().runTransaction(async (tx) => {
      const freshImport = await tx.get(importRef);
      if (!freshImport.exists) {
        throw new HttpsError("not-found", "Vendor invoice import not found.");
      }
      const fresh = freshImport.data() as VendorInvoiceImportDoc;
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

      tx.update(importRef, {
        reviewStatus: "approved",
        linkedDeliveryOrderId: deliveryOrderId,
        approvedAt: now,
        approvedBy: uid,
        rejectedAt: FieldValue.delete(),
        rejectedBy: FieldValue.delete(),
        updatedAt: now,
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
  },
);
