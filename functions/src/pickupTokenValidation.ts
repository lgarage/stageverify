import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

export const DEFAULT_PICKUP_TOKEN_DAYS = 7;

export function hashPickupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function asPickupToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) return null;
  return trimmed;
}

export function asJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

export interface PickupTokenDoc {
  id: string;
  jobId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export function isPickupTokenActive(
  doc: PickupTokenDoc,
  nowMs: number = Date.now(),
): boolean {
  if (doc.revokedAt) return false;
  const expiresMs = Date.parse(doc.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return false;
  return true;
}

export async function verifyPickupTokenForJob(
  db: admin.firestore.Firestore,
  token: string,
  jobId: string,
): Promise<void> {
  const tokenHash = hashPickupToken(token);
  const snap = await db.collection("pickupTokens").doc(tokenHash).get();
  if (!snap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Invalid or expired pickup link.",
    );
  }
  const data = snap.data() as PickupTokenDoc;
  if (!isPickupTokenActive(data)) {
    throw new HttpsError(
      "permission-denied",
      "Invalid or expired pickup link.",
    );
  }
  if (data.jobId !== jobId) {
    throw new HttpsError(
      "permission-denied",
      "Pickup link does not match this job.",
    );
  }
}
