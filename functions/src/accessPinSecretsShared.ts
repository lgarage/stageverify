import * as admin from "firebase-admin";
import type { PinEncrypted } from "./accessPinCrypto";

export const ACCESS_PIN_SECRETS_COLLECTION = "accessPinSecrets";
export const ACCESS_PIN_UNIQUENESS_COLLECTION = "accessPinUniqueness";
export const PIN_ACCESS_AUDIT_COLLECTION = "pinAccessAudit";
export const ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = "accessPinRevealAttempts";
export const ACCESS_PIN_SET_ATTEMPTS_COLLECTION = "accessPinSetAttempts";
export const ADMIN_ACCESS_SESSIONS_COLLECTION = "adminAccessSessions";

export type AccessPinTargetType = "technician" | "vendor" | "management";

/** Audit target may include Auth dispatcher identities (not PIN secret targets). */
export type PinAccessAuditTargetType = AccessPinTargetType | "dispatcher";

export type AccessPinSecretDoc = {
  targetType: AccessPinTargetType;
  targetId: string;
  pinHash: string;
  pinEncrypted: PinEncrypted;
  /** HMAC-SHA256 hex for indexed lookup; unset on hash-only migrated secrets. */
  pinLookupKey?: string;
  revealable: boolean;
  updatedAt: string;
};

export type AccessPinUniquenessDoc = {
  targetType: AccessPinTargetType;
  targetId: string;
  updatedAt: string;
};

export type PinAccessAuditAction =
  | "admin_access_granted"
  | "admin_access_revoked"
  | "admin_access_denied"
  | "pin_revealed"
  | "pin_reveal_denied"
  | "pin_changed"
  | "pin_change_denied"
  | "dispatcher_removed"
  | "admin_created"
  | "admin_deactivated"
  | "role_changed_to_admin"
  | "role_changed_from_admin"
  | "admin_pin_set"
  | "admin_pin_set_denied"
  | "admin_bootstrap";

export const ACCESS_CONTROL_LOCKS_COLLECTION = "accessControlLocks";
export const FIRST_ADMIN_BOOTSTRAP_LOCK_ID = "firstAdmin";

export type PinAccessAuditDoc = {
  action: PinAccessAuditAction;
  targetType: PinAccessAuditTargetType;
  targetId: string;
  actorUid: string;
  createdAt: string;
  /** Named Admin display identity when known — never PIN material. */
  actorFullName?: string;
};

export function getDb() {
  return admin.firestore();
}

export function accessPinSecretDocId(
  targetType: AccessPinTargetType,
  targetId: string,
): string {
  return `${targetType}_${targetId}`;
}

/** Uniqueness index doc id — second arg is HMAC lookup key from pinLookupKeyForPin, not plaintext PIN. */
export function accessPinUniquenessDocId(
  targetType: AccessPinTargetType,
  pinLookupKey: string,
): string {
  return `${targetType}_${pinLookupKey}`;
}

export function parseAccessPinTargetType(
  value: unknown,
): AccessPinTargetType | null {
  if (
    value === "technician" ||
    value === "vendor" ||
    value === "management"
  ) {
    return value;
  }
  return null;
}

/** Write audit entry — throws on failure (fail-closed for reveal path). */
export async function writePinAccessAudit(input: {
  action: PinAccessAuditAction;
  targetType: PinAccessAuditTargetType;
  targetId: string;
  actorUid: string;
  actorFullName?: string;
}): Promise<string> {
  const ref = getDb().collection(PIN_ACCESS_AUDIT_COLLECTION).doc();
  const createdAt = new Date().toISOString();
  const doc: PinAccessAuditDoc = {
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    actorUid: input.actorUid,
    createdAt,
  };
  if (typeof input.actorFullName === "string" && input.actorFullName.trim()) {
    doc.actorFullName = input.actorFullName.trim();
  }
  await ref.set(doc);
  return ref.id;
}

/** Best-effort audit when manager check fails — never throws. */
export async function writePinAccessAuditBestEffort(input: {
  action: PinAccessAuditAction;
  targetType: PinAccessAuditTargetType;
  targetId: string;
  actorUid?: string;
}): Promise<void> {
  try {
    await writePinAccessAudit({
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      actorUid: input.actorUid ?? "unknown",
    });
  } catch (err) {
    console.error(`pinAccessAudit ${input.action} write failed:`, err);
  }
}
