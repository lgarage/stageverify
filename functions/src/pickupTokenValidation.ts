import { createHash } from "crypto";

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
