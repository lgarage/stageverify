/**
 * Dispatcher inspect API for inbound email processing records.
 */
import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { InboundEmailProcessingDoc, VendorInvoiceImportDoc } from "./inboundEmail/types";
import { clampListLimit, requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { recoverStrandedInboundProcessingList } from "./inboundEmail/recoverStrandedProcessing";
import { sanitizeVendorInvoiceImportForClient } from "./inboundEmail/sanitizeVendorInvoiceImport";
import { gmailClientId, gmailClientSecret } from "./gmailApi";
import {
  downloadGmailAttachment,
  fetchGmailMessage,
  findPdfAttachments,
  getGmailAccessTokenForProvider,
} from "./gmailInbound";

const COLLECTION = "inboundEmailProcessing";
const IMPORTS_COLLECTION = "vendorInvoiceImports";
const MAX_LIST = 50;
const MAX_TEXT_PREVIEW = 4000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

function getDb() {
  return admin.firestore();
}

async function loadGmailRefreshToken(): Promise<string> {
  const conn = await getDb().collection("emailProviderConnections").doc("gmail").get();
  if (!conn.exists) {
    throw new HttpsError("failed-precondition", "Gmail is not connected.");
  }
  const status = (conn.data() as { status?: string }).status;
  if (status !== "connected") {
    throw new HttpsError("failed-precondition", "Gmail is not connected.");
  }
  const secretSnap = await getDb().collection("emailProviderSecrets").doc("gmail").get();
  if (!secretSnap.exists) {
    throw new HttpsError("failed-precondition", "Gmail credentials are missing.");
  }
  const refreshToken = (secretSnap.data() as { refreshToken?: string }).refreshToken?.trim();
  if (!refreshToken) {
    throw new HttpsError("failed-precondition", "Gmail refresh token is missing.");
  }
  return refreshToken;
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
    await requireDispatcherAuth(request);
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
    await requireDispatcherAuth(request);
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
    await requireDispatcherAuth(request);
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

export const getVendorInvoiceImport = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as { id?: string };
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id || id.length > 256) {
      throw new HttpsError("invalid-argument", "id is required.");
    }

    const snap = await getDb().collection(IMPORTS_COLLECTION).doc(id).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Vendor invoice import not found.");
    }

    return sanitizeVendorInvoiceImportForClient(snap.data() as VendorInvoiceImportDoc);
  },
);

export const getVendorInvoicePdf = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: [gmailClientId, gmailClientSecret],
  },
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

    const importSnap = await getDb().collection(IMPORTS_COLLECTION).doc(importId).get();
    if (!importSnap.exists) {
      throw new HttpsError("not-found", "Vendor invoice import not found.");
    }
    const importDoc = importSnap.data() as VendorInvoiceImportDoc;
    const inboundId = importDoc.inboundEmailProcessingId?.trim();
    if (!inboundId) {
      throw new HttpsError("failed-precondition", "Import has no inbound email record.");
    }

    const inboundSnap = await getDb().collection(COLLECTION).doc(inboundId).get();
    if (!inboundSnap.exists) {
      throw new HttpsError("not-found", "Inbound email processing record not found.");
    }
    const inbound = inboundSnap.data() as InboundEmailProcessingDoc;
    const gmailMessageId = inbound.gmailMessageId?.trim();
    if (!gmailMessageId) {
      throw new HttpsError("failed-precondition", "Inbound email has no Gmail message id.");
    }

    // Always return the source/org PDF for the inbound message (full multi-invoice
    // attachment). pageIndexInBatch is a logical invoice index, not an attachment index.
    const attachments = inbound.pdfAttachments ?? [];
    const attachment =
      attachments.find((att) => Boolean(att.gmailAttachmentId) && !att.extractError) ??
      attachments.find((att) => Boolean(att.gmailAttachmentId)) ??
      attachments[0];
    if (!attachment?.gmailAttachmentId) {
      throw new HttpsError(
        "failed-precondition",
        "No PDF attachment metadata on this inbound email.",
      );
    }

    const refreshToken = await loadGmailRefreshToken();
    let accessToken: string;
    try {
      accessToken = await getGmailAccessTokenForProvider(refreshToken);
    } catch (err) {
      if (err instanceof Error && err.message.includes("token refresh failed")) {
        throw new HttpsError(
          "failed-precondition",
          "Gmail connection expired. Disconnect and reconnect Gmail in Settings, then try again.",
        );
      }
      throw err;
    }

    let bytes: Buffer;
    try {
      bytes = await downloadGmailAttachment(
        accessToken,
        gmailMessageId,
        attachment.gmailAttachmentId,
      );
    } catch {
      try {
        const message = await fetchGmailMessage(accessToken, gmailMessageId);
        const freshPdfs = findPdfAttachments(message.payload);
        const freshAttachment =
          freshPdfs.find((pdf) => pdf.attachmentId) ?? freshPdfs[0];
        if (!freshAttachment?.attachmentId) {
          throw new HttpsError(
            "unavailable",
            "Gmail attachment download failed. The PDF may have been moved or deleted.",
          );
        }
        bytes = await downloadGmailAttachment(
          accessToken,
          gmailMessageId,
          freshAttachment.attachmentId,
        );
      } catch {
        throw new HttpsError(
          "unavailable",
          "Gmail attachment download failed. The PDF may have been moved or deleted.",
        );
      }
    }
    if (bytes.length > MAX_PDF_BYTES) {
      throw new HttpsError(
        "failed-precondition",
        "Invoice PDF exceeds maximum download size.",
      );
    }

    return {
      filename: attachment.filename || "invoice.pdf",
      mimeType: attachment.mimeType || "application/pdf",
      sizeBytes: bytes.length,
      dataBase64: bytes.toString("base64"),
    };
  },
);
