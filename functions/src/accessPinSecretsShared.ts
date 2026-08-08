import * as admin from "firebase-admin";
import type { PinEncrypted } from "./accessPinCrypto";

export const ACCESS_PIN_SECRETS_COLLECTION = "accessPinSecrets";
export const ACCESS_PIN_UNIQUENESS_COLLECTION = "accessPinUniqueness";
export const PIN_ACCESS_AUDIT_COLLECTION = "pinAccessAudit";
export const ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = "accessPinRevealAttempts";
export const ACCESS_PIN_SET_ATTEMPTS_COLLECTION = "accessPinSetAttempts";
export const ADMIN_ACCESS_SESSIONS_COLLECTION = "adminAccessSessions";

export type AccessPinTargetType = "technician" | "vendor" | "management";

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
  | "pin_change_denied";

export type PinAccessAuditDoc = {
  action: PinAccessAuditAction;
  targetType: AccessPinTargetType;
  targetId: string;
  actorUid: string;
  createdAt: string;
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
  targetType: AccessPinTargetType;
  targetId: string;
  actorUid: string;
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
  await ref.set(doc);
  return ref.id;
}

/** Best-effort audit when manager check fails — never throws. */
export async function writePinAccessAuditBestEffort(input: {
  action: PinAccessAuditAction;
  targetType: AccessPinTargetType;
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
