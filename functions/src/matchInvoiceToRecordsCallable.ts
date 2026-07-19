/**
 * matchInvoiceToRecords — PO / sales order / job hint → candidate deliveries (read-only).
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { loadEmailMatchContext } from "./email/loadMatchContext";
import { matchInvoiceToRecords } from "./invoice/matchInvoiceToRecords";
import { asParsedHeaderForImport } from "./invoice/parsedHeaderValidation";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";

const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_NOTES_SCAN = 200;

function getDb() {
  return admin.firestore();
}

import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

async function loadDeliveryNotes(
  deliveryIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const db = getDb();
  const ids = deliveryIds.slice(0, MAX_NOTES_SCAN);
  await Promise.all(
    ids.map(async (id) => {
      const snap = await db.collection("deliveries").doc(id).get();
      if (!snap.exists) return;
      const notes = snap.data()?.notes;
      if (typeof notes === "string") map.set(id, notes);
    }),
  );
  return map;
}

export const matchInvoiceToRecordsCallable = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { vendorInvoiceImportId?: string };
    const importId =
      typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    if (!importId || importId.length > 256) {
      throw new HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }

    const snap = await getDb().collection(REVIEW_COLLECTION).doc(importId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Vendor invoice import not found.");
    }

    const doc = snap.data() as VendorInvoiceImportDoc;
    const header = asParsedHeaderForImport(doc.parsedHeader);

    const ctx = await loadEmailMatchContext();
    const deliveryNotesById = await loadDeliveryNotes(ctx.deliveries.map((d) => d.id));

    const result = matchInvoiceToRecords(importId, header, ctx, deliveryNotesById);

    return {
      ...result,
      importStatus: doc.importStatus,
      reviewStatus: doc.reviewStatus,
    };
  },
);
