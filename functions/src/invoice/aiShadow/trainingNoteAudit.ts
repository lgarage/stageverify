/**
 * 90-day raw-note audit stream — CF Admin SDK only (D-59 P7).
 */
import type { Firestore } from "firebase-admin/firestore";
import { TRAINING_NOTE_AUDIT_TTL_DAYS } from "./constants";

export const TRAINING_NOTE_AUDIT_COLLECTION = "trainingNoteAudit";

export type TrainingNoteAuditLane = "playbook" | "ignore";

export type TrainingNoteAuditDoc = {
  uid: string;
  importId: string;
  vendorKey: string;
  noteRaw: string;
  noteRedacted: string;
  lane: TrainingNoteAuditLane;
  createdAt: string;
  expireAt: string;
};

export type TrainingNoteAuditListItem = Omit<TrainingNoteAuditDoc, "noteRaw"> & {
  id: string;
  /** Raw note — manager/admin callable only. */
  noteRaw?: string;
};

function expireAtFromNow(now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + TRAINING_NOTE_AUDIT_TTL_DAYS);
  return d.toISOString();
}

export { expireAtFromNow };

export async function writeTrainingNoteAudit(
  db: Firestore,
  input: {
    uid: string;
    importId: string;
    vendorKey: string;
    noteRaw: string;
    noteRedacted: string;
    lane: TrainingNoteAuditLane;
  },
): Promise<string> {
  const createdAt = new Date().toISOString();
  const ref = db.collection(TRAINING_NOTE_AUDIT_COLLECTION).doc();
  const doc: TrainingNoteAuditDoc = {
    uid: input.uid.trim(),
    importId: input.importId.trim(),
    vendorKey: input.vendorKey.trim(),
    noteRaw: input.noteRaw.slice(0, 800),
    noteRedacted: input.noteRedacted.slice(0, 800),
    lane: input.lane,
    createdAt,
    expireAt: expireAtFromNow(),
  };
  await ref.set(doc);
  return ref.id;
}

export async function listTrainingNoteAudit(
  db: Firestore,
  input: { limit?: number; includeRaw?: boolean },
): Promise<TrainingNoteAuditListItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const snap = await db
    .collection(TRAINING_NOTE_AUDIT_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as TrainingNoteAuditDoc;
    const item: TrainingNoteAuditListItem = {
      id: d.id,
      uid: data.uid,
      importId: data.importId,
      vendorKey: data.vendorKey,
      noteRedacted: data.noteRedacted,
      lane: data.lane,
      createdAt: data.createdAt,
      expireAt: data.expireAt,
    };
    if (input.includeRaw) {
      item.noteRaw = data.noteRaw;
    }
    return item;
  });
}
