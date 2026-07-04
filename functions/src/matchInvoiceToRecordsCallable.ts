/**
 * matchInvoiceToRecords — PO / sales order / job hint → candidate deliveries (read-only).
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { loadEmailMatchContext } from "./email/loadMatchContext";
import { matchInvoiceToRecords } from "./invoice/matchInvoiceToRecords";
import type { ParsedInvoiceHeader } from "./invoice/types";
import type { VendorInvoiceImportDoc } from "./inboundEmail/types";

const REVIEW_COLLECTION = "vendorInvoiceImports";
const MAX_NOTES_SCAN = 200;

function getDb() {
  return admin.firestore();
}

function requireAuth(request: { auth?: { uid?: string } }): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to match invoice imports.");
  }
  return request.auth.uid;
}

function asParsedHeader(raw: Record<string, unknown>): ParsedInvoiceHeader {
  const str = (key: string, required = false): string => {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (required) throw new HttpsError("failed-precondition", `Invoice header missing ${key}.`);
    return "";
  };
  return {
    customerAccountNumber: str("customerAccountNumber", true),
    vendorOrderNumber: str("vendorOrderNumber", true),
    vendorInvoiceNumber: str("vendorInvoiceNumber", true),
    customerPoOrReference: str("customerPoOrReference", true),
    quoteNumber: str("quoteNumber") || undefined,
    orderDate: str("orderDate", true),
    invoiceDate: str("invoiceDate", true),
    shipDate: str("shipDate", true),
    buyerName: str("buyerName") || undefined,
    shipViaRaw: str("shipViaRaw") || undefined,
    jobNumberRaw: str("jobNumberRaw") || undefined,
    vendorBranchName: str("vendorBranchName", true),
    vendorBranchAddress: str("vendorBranchAddress", true),
    vendorBranchPhone: str("vendorBranchPhone", true),
    soldToName: str("soldToName", true),
    shipToName: str("shipToName", true),
    shipToAddress: str("shipToAddress", true),
    fulfillmentMethod:
      raw.fulfillmentMethod === "delivery" ||
      raw.fulfillmentMethod === "will_call_pickup" ||
      raw.fulfillmentMethod === "unknown"
        ? raw.fulfillmentMethod
        : "unknown",
    shipCompletePolicy:
      raw.shipCompletePolicy === "hold_until_complete" ||
      raw.shipCompletePolicy === "allow_partial" ||
      raw.shipCompletePolicy === "unknown"
        ? raw.shipCompletePolicy
        : "unknown",
  };
}

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
    requireAuth(request);
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
    const header = asParsedHeader(doc.parsedHeader);

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
