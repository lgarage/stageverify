/**
 * Immutable audit stream for vendor invoice field lessons (C3-D.1).
 * Admin SDK create-only — clients read via callable (Manager/Admin).
 */
import type { Firestore } from "firebase-admin/firestore";

export const FIELD_LESSON_AUDIT_COLLECTION = "vendorInvoiceFieldLessonAuditEvents";

export type FieldLessonAuditEventType =
  | "proposed"
  | "proposal_refreshed"
  | "contradiction_blocked"
  | "contradiction_auto_suspended"
  | "threshold_auto_suspended"
  | "evaluate_noop";

export type FieldLessonAuditEventDoc = {
  lessonId: string;
  eventType: FieldLessonAuditEventType;
  actorUid: string | "system";
  atIso: string;
  priorStatus?: string | null;
  newStatus?: string | null;
  detail?: string;
  scopeKey?: string;
  patternFingerprint?: string;
  distinctDocumentCount?: number;
};

export async function writeFieldLessonAuditEvent(
  db: Firestore,
  input: {
    lessonId: string;
    eventType: FieldLessonAuditEventType;
    actorUid: string | "system";
    priorStatus?: string | null;
    newStatus?: string | null;
    detail?: string;
    scopeKey?: string;
    patternFingerprint?: string;
    distinctDocumentCount?: number;
  },
): Promise<string> {
  const atIso = new Date().toISOString();
  const ref = db.collection(FIELD_LESSON_AUDIT_COLLECTION).doc();
  const doc: FieldLessonAuditEventDoc = {
    lessonId: input.lessonId.trim(),
    eventType: input.eventType,
    actorUid: input.actorUid,
    atIso,
    ...(input.priorStatus !== undefined
      ? { priorStatus: input.priorStatus }
      : {}),
    ...(input.newStatus !== undefined ? { newStatus: input.newStatus } : {}),
    ...(input.detail?.trim()
      ? { detail: input.detail.trim().slice(0, 500) }
      : {}),
    ...(input.scopeKey?.trim() ? { scopeKey: input.scopeKey.trim() } : {}),
    ...(input.patternFingerprint?.trim()
      ? { patternFingerprint: input.patternFingerprint.trim() }
      : {}),
    ...(typeof input.distinctDocumentCount === "number"
      ? { distinctDocumentCount: input.distinctDocumentCount }
      : {}),
  };
  await ref.set(doc);
  return ref.id;
}
