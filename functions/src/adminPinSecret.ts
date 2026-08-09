/**
 * Named Admin privileged PIN — hash-only, self-targeted.
 * Never encrypted for reveal; never flows through AccessPinTargetType reveal surface.
 */
import { HttpsError } from "firebase-functions/v2/https";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  getDb,
} from "./accessPinSecretsShared";
import { hashPinForStorage } from "./pinHashing";
import { pinMatches } from "./pinMatching";

/** Exactly 6 numeric digits — distinct from tech/vendor/management 4–6. */
export function asAdminPin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{6}$/.test(trimmed)) return null;
  return trimmed;
}

export function adminPinSecretDocId(uid: string): string {
  return `admin_${uid}`;
}

export type AdminPinSecretDoc = {
  targetType: "admin";
  targetId: string;
  pinHash: string;
  revealable: false;
  updatedAt: string;
};

/** Persist caller's Admin PIN (hash-only). targetId always = uid. */
export async function setOwnAdminPin(
  uid: string,
  pinRaw: unknown,
): Promise<void> {
  const pin = asAdminPin(pinRaw);
  if (!pin) {
    throw new HttpsError(
      "invalid-argument",
      "Admin PIN must be exactly 6 digits.",
    );
  }
  const now = new Date().toISOString();
  const doc: AdminPinSecretDoc = {
    targetType: "admin",
    targetId: uid,
    pinHash: hashPinForStorage(pin),
    revealable: false,
    updatedAt: now,
  };
  await getDb()
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(adminPinSecretDocId(uid))
    .set(doc);
}

/** Verify Admin PIN for the authenticated uid. Never returns PIN material. */
export async function verifyOwnAdminPinForSession(
  uid: string,
  pinRaw: unknown,
): Promise<boolean> {
  const pin = asAdminPin(pinRaw);
  if (!pin) return false;

  const snap = await getDb()
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(adminPinSecretDocId(uid))
    .get();
  if (!snap.exists) return false;

  const data = snap.data() as { pinHash?: string; revealable?: boolean };
  if (typeof data.pinHash !== "string" || data.pinHash.length === 0) {
    return false;
  }
  return pinMatches({ pinHash: data.pinHash }, pin);
}

/** Clear Admin PIN secret when role leaves Admin (fail-closed privilege strip). */
export async function clearOwnAdminPin(uid: string): Promise<void> {
  const ref = getDb()
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(adminPinSecretDocId(uid));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
  }
}
