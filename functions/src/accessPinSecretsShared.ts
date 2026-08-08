import * as admin from "firebase-admin";
import type { PinEncrypted } from "./accessPinCrypto";

export const ACCESS_PIN_SECRETS_COLLECTION = "accessPinSecrets";
export const ACCESS_PIN_UNIQUENESS_COLLECTION = "accessPinUniqueness";
export const PIN_ACCESS_AUDIT_COLLECTION = "pinAccessAudit";
export const ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION = "accessPinRevealAttempts";
export const ACCESS_PIN_SET_ATTEMPTS_COLLECTION = "accessPinSetAttempts";

export type AccessPinTargetType = "technician" | "vendor";

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
  | "PIN_SET"
  | "PIN_REVEALED"
  | "PIN_REVEAL_DENIED";

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
  if (value === "technician" || value === "vendor") return value;
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
export async function writePinRevealDeniedAuditBestEffort(input: {
  targetType: AccessPinTargetType;
  targetId: string;
  actorUid?: string;
}): Promise<void> {
  try {
    await writePinAccessAudit({
      action: "PIN_REVEAL_DENIED",
      targetType: input.targetType,
      targetId: input.targetId,
      actorUid: input.actorUid ?? "unknown",
    });
  } catch (err) {
    console.error("pinAccessAudit PIN_REVEAL_DENIED write failed:", err);
  }
}
