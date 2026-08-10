/**
 * Immutable audit stream for vendor invoice field lessons (C3-D.1).
 * Admin SDK create-only — clients read via callable (Manager/Admin).
 */
import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";

export const FIELD_LESSON_AUDIT_COLLECTION = "vendorInvoiceFieldLessonAuditEvents";

export type FieldLessonAuditEventType =
  | "proposed"
  | "proposal_refreshed"
  | "contradiction_blocked"
  | "contradiction_auto_suspended"
  | "threshold_auto_suspended"
  | "pattern_superseded_auto_suspended"
  | "evaluate_noop"
  | "activated"
  | "activation_revalidation_failed"
  | "rejected"
  | "manual_suspended"
  | "reactivated"
  | "reactivation_revalidation_failed";

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

export type FieldLessonAuditEventInput = {
  lessonId: string;
  eventType: FieldLessonAuditEventType;
  actorUid: string | "system";
  priorStatus?: string | null;
  newStatus?: string | null;
  detail?: string;
  scopeKey?: string;
  patternFingerprint?: string;
  distinctDocumentCount?: number;
};

export function buildFieldLessonAuditEventDoc(
  input: FieldLessonAuditEventInput,
  atIso: string,
): FieldLessonAuditEventDoc {
  return {
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
}

export function writeFieldLessonAuditEventInTransaction(
  tx: Transaction,
  auditRef: DocumentReference,
  input: FieldLessonAuditEventInput,
  atIso: string,
): void {
  tx.set(auditRef, buildFieldLessonAuditEventDoc(input, atIso));
}

export async function writeFieldLessonAuditEvent(
  db: Firestore,
  input: FieldLessonAuditEventInput,
): Promise<string> {
  const atIso = new Date().toISOString();
  const ref = db.collection(FIELD_LESSON_AUDIT_COLLECTION).doc();
  await ref.set(buildFieldLessonAuditEventDoc(input, atIso));
  return ref.id;
}
