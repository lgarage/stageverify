/**
 * Recover inboundEmailProcessing docs stuck in processingStatus=processing.
 */
import * as admin from "firebase-admin";
import type { InboundEmailProcessingDoc } from "./types";

const STRANDED_PROCESSING_MS = 10 * 60 * 1000;

function getDb() {
  return admin.firestore();
}

export async function recoverStrandedInboundProcessing(
  doc: InboundEmailProcessingDoc,
): Promise<InboundEmailProcessingDoc> {
  if (doc.processingStatus !== "processing") return doc;

  const updatedMs = Date.parse(doc.updatedAt || doc.createdAt);
  if (Number.isNaN(updatedMs)) return doc;
  if (Date.now() - updatedMs < STRANDED_PROCESSING_MS) return doc;

  const ref = getDb().collection("inboundEmailProcessing").doc(doc.id);
  const now = new Date().toISOString();
  const patch = {
    processingStatus: "error" as const,
    processingError: "Processing interrupted — retry inbound sync or inspect logs.",
    updatedAt: now,
  };

  await getDb().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) return;
    const data = fresh.data() as InboundEmailProcessingDoc;
    if (data.processingStatus !== "processing") return;
    const freshUpdatedMs = Date.parse(data.updatedAt || data.createdAt);
    if (Number.isNaN(freshUpdatedMs) || Date.now() - freshUpdatedMs < STRANDED_PROCESSING_MS) {
      return;
    }
    tx.update(ref, patch);
  });

  const after = await ref.get();
  if (!after.exists) return doc;
  return after.data() as InboundEmailProcessingDoc;
}

export async function recoverStrandedInboundProcessingList(
  docs: InboundEmailProcessingDoc[],
): Promise<InboundEmailProcessingDoc[]> {
  return Promise.all(docs.map((d) => recoverStrandedInboundProcessing(d)));
}
