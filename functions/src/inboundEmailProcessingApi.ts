/**
 * Dispatcher inspect API for inbound email processing records.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { InboundEmailProcessingDoc } from "./inboundEmail/types";

const COLLECTION = "inboundEmailProcessing";
const MAX_LIST = 50;
const MAX_TEXT_PREVIEW = 4000;

function getDb() {
  return admin.firestore();
}

function requireAuth(request: { auth?: { uid?: string } }): string {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in to view inbound email processing.");
  }
  return request.auth.uid;
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
    requireAuth(request);
    const data = (request.data ?? {}) as { limit?: number };
    const limit =
      typeof data.limit === "number" && data.limit > 0 && data.limit <= MAX_LIST
        ? Math.floor(data.limit)
        : 25;

    const snap = await getDb()
      .collection(COLLECTION)
      .orderBy("receivedAt", "desc")
      .limit(limit)
      .get();

    const items = snap.docs.map((d) =>
      sanitizeDocForClient(d.data() as InboundEmailProcessingDoc),
    );

    return { items, count: items.length };
  },
);

export const getInboundEmailProcessing = onCall(
  { region: "us-central1" },
  async (request) => {
    requireAuth(request);
    const data = (request.data ?? {}) as { id?: string };
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id || id.length > 256) {
      throw new HttpsError("invalid-argument", "id is required.");
    }

    const snap = await getDb().collection(COLLECTION).doc(id).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Inbound email processing record not found.");
    }

    return sanitizeDocForClient(snap.data() as InboundEmailProcessingDoc);
  },
);

export const listVendorInvoiceImports = onCall(
  { region: "us-central1" },
  async (request) => {
    requireAuth(request);
    const data = (request.data ?? {}) as { inboundEmailProcessingId?: string; limit?: number };
    const inboundId =
      typeof data.inboundEmailProcessingId === "string"
        ? data.inboundEmailProcessingId.trim()
        : "";
    const limit =
      typeof data.limit === "number" && data.limit > 0 && data.limit <= MAX_LIST
        ? Math.floor(data.limit)
        : 25;

    let query = getDb().collection("vendorInvoiceImports").orderBy("createdAt", "desc");
    if (inboundId) {
      query = query.where("inboundEmailProcessingId", "==", inboundId);
    }
    const snap = await query.limit(limit).get();
    return { items: snap.docs.map((d) => d.data()), count: snap.size };
  },
);
