/**
 * approveVendorInvoiceImport — explicit approve/reject; writes expected items only.
 * Does NOT set qtyReceived, staging, or readiness.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { buildExpectedItemsFromImport } from "./invoice/buildExpectedItemsFromImport";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";

const REVIEW_COLLECTION = "vendorInvoiceImports";

function getDb() {
  return admin.firestore();
}

import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

export const approveVendorInvoiceImport = onCall(
  { region: "us-central1" },
  async (request) => {
    const uid = requireDispatcherAuth(request);
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
    if (action !== "approve" && action !== "reject") {
      throw new HttpsError("invalid-argument", "action must be approve or reject.");
    }
    if (action === "approve" && (!deliveryOrderId || deliveryOrderId.length > 256)) {
      throw new HttpsError("invalid-argument", "deliveryOrderId is required to approve.");
    }

    const importRef = getDb().collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
      throw new HttpsError("not-found", "Vendor invoice import not found.");
    }

    const importDoc = importSnap.data() as VendorInvoiceImportDoc;
    if (importDoc.reviewStatus !== "pending_review") {
      throw new HttpsError(
        "failed-precondition",
        `Import already ${importDoc.reviewStatus}.`,
      );
    }

    const now = new Date().toISOString();

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
    const priorNotes = typeof delivery.notes === "string" ? delivery.notes : "";
    const notes = priorNotes.includes(evidenceNote)
      ? priorNotes
      : priorNotes
        ? `${priorNotes}\n${evidenceNote}`
        : evidenceNote;

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
  },
);
