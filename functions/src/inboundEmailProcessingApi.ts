/**
 * Dispatcher inspect API for inbound email processing records.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { InboundEmailProcessingDoc, VendorInvoiceImportDoc } from "./inboundEmail/types";
import { clampListLimit, requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { recoverStrandedInboundProcessingList } from "./inboundEmail/recoverStrandedProcessing";
import { sanitizeVendorInvoiceImportForClient } from "./inboundEmail/sanitizeVendorInvoiceImport";

const COLLECTION = "inboundEmailProcessing";
const MAX_LIST = 50;
const MAX_TEXT_PREVIEW = 4000;

function getDb() {
  return admin.firestore();
}

function sanitizeDocForClient(doc: InboundEmailProcessingDoc): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  if (
    typeof out.combinedExtractedText === "string" &&
    (out.combinedExtractedText as string).length > MAX_TEXT_PREVIEW
  ) {
    out.combinedExtractedTextPreview = (out.combinedExtractedText as string).slice(
      0,
      MAX_TEXT_PREVIEW,
    );
    out.combinedExtractedTextTruncated = true;
    delete out.combinedExtractedText;
  }
  if (Array.isArray(out.pdfAttachments)) {
    out.pdfAttachments = (out.pdfAttachments as InboundEmailProcessingDoc["pdfAttachments"]).map(
      (att) => {
        const copy = { ...att };
        if (copy.extractedText && copy.extractedText.length > MAX_TEXT_PREVIEW) {
          copy.extractedText = `${copy.extractedText.slice(0, MAX_TEXT_PREVIEW)}…[truncated]`;
        }
        return copy;
      },
    );
  }
  return out;
}

export const listInboundEmailProcessing = onCall(
  { region: "us-central1" },
  async (request) => {
    requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { limit?: number };
    const limit = clampListLimit(data.limit, 25, MAX_LIST);

    const snap = await getDb()
      .collection(COLLECTION)
      .orderBy("receivedAt", "desc")
      .limit(limit)
      .get();

    const raw = snap.docs.map((d) => d.data() as InboundEmailProcessingDoc);
    const recovered = await recoverStrandedInboundProcessingList(raw);
    const items = recovered.map((d) => sanitizeDocForClient(d));

    return { items, count: items.length };
  },
);

export const getInboundEmailProcessing = onCall(
  { region: "us-central1" },
  async (request) => {
    requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { id?: string };
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id || id.length > 256) {
      throw new HttpsError("invalid-argument", "id is required.");
    }

    const snap = await getDb().collection(COLLECTION).doc(id).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Inbound email processing record not found.");
    }

    const [recovered] = await recoverStrandedInboundProcessingList([
      snap.data() as InboundEmailProcessingDoc,
    ]);

    return sanitizeDocForClient(recovered);
  },
);

export const listVendorInvoiceImports = onCall(
  { region: "us-central1" },
  async (request) => {
    requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { inboundEmailProcessingId?: string; limit?: number };
    const inboundId =
      typeof data.inboundEmailProcessingId === "string"
        ? data.inboundEmailProcessingId.trim()
        : "";
    const limit = clampListLimit(data.limit, 25, MAX_LIST);

    let query = getDb().collection("vendorInvoiceImports").orderBy("createdAt", "desc");
    if (inboundId) {
      query = query.where("inboundEmailProcessingId", "==", inboundId);
    }
    const snap = await query.limit(limit).get();
    const items = snap.docs.map((d) =>
      sanitizeVendorInvoiceImportForClient(d.data() as VendorInvoiceImportDoc),
    );
    return { items, count: items.length };
  },
);
