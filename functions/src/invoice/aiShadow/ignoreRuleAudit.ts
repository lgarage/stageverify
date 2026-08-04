/**
 * Immutable audit stream for vendor invoice ignore rules (D-59 P5).
 * Admin SDK create-only — clients read via callable.
 */
import type { Firestore } from "firebase-admin/firestore";

export const IGNORE_RULE_AUDIT_COLLECTION = "ignoreRuleAuditEvents";

export type IgnoreRuleAuditEventType =
  | "proposed"
  | "activated"
  | "deactivated_manual"
  | "archived"
  | "rule_matched"
  | "match_suppressed_strong_signals"
  | "match_reopened"
  | "auto_disabled_false_positive"
  | "validation_rejected";

export type IgnoreRuleAuditEventDoc = {
  ruleId: string;
  eventType: IgnoreRuleAuditEventType;
  actorUid: string | "system";
  atIso: string;
  importId?: string;
  detail?: string;
};

export async function writeIgnoreRuleAuditEvent(
  db: Firestore,
  input: {
    ruleId: string;
    eventType: IgnoreRuleAuditEventType;
    actorUid: string | "system";
    importId?: string;
    detail?: string;
  },
): Promise<string> {
  const atIso = new Date().toISOString();
  const ref = db.collection(IGNORE_RULE_AUDIT_COLLECTION).doc();
  const doc: IgnoreRuleAuditEventDoc = {
    ruleId: input.ruleId.trim(),
    eventType: input.eventType,
    actorUid: input.actorUid,
    atIso,
    ...(input.importId?.trim() ? { importId: input.importId.trim() } : {}),
    ...(input.detail?.trim()
      ? { detail: input.detail.trim().slice(0, 500) }
      : {}),
  };
  await ref.set(doc);
  return ref.id;
}

export async function listIgnoreRuleAuditEvents(
  db: Firestore,
  input: { ruleId: string; limit?: number },
): Promise<Array<IgnoreRuleAuditEventDoc & { id: string }>> {
  const ruleId = input.ruleId.trim();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const snap = await db
    .collection(IGNORE_RULE_AUDIT_COLLECTION)
    .where("ruleId", "==", ruleId)
    .orderBy("atIso", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as IgnoreRuleAuditEventDoc),
  }));
}
