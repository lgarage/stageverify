import { createHash, randomBytes } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import {
  ADMIN_ACCESS_SESSIONS_COLLECTION,
  getDb,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";

export const ADMIN_ACCESS_SESSION_TTL_MS = 5 * 60 * 1000;

export interface AdminAccessSessionDoc {
  managerUid: string;
  targetType: AccessPinTargetType;
  targetId: string;
  /** sha256 hex of the raw token suffix. */
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  consumedAt?: string;
}

export function hashAdminAccessSessionRaw(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Token format: `{sessionId}.{raw}` — 16-byte hex id + 32-byte hex raw. */
export function parseAdminAccessSessionToken(
  token: string,
): { sessionId: string; raw: string } | null {
  const trimmed = token.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot >= trimmed.length - 1) return null;
  const sessionId = trimmed.slice(0, dot);
  const raw = trimmed.slice(dot + 1);
  if (!/^[0-9a-f]{32}$/.test(sessionId)) return null;
  if (!/^[0-9a-f]{64}$/.test(raw)) return null;
  return { sessionId, raw };
}

export function formatAdminAccessSessionToken(
  sessionId: string,
  raw: string,
): string {
  return `${sessionId}.${raw}`;
}

export async function createAdminAccessSession(input: {
  managerUid: string;
  targetType: AccessPinTargetType;
  targetId: string;
}): Promise<{ sessionToken: string; expiresAt: string }> {
  const sessionId = randomBytes(16).toString("hex");
  const raw = randomBytes(32).toString("hex");
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ADMIN_ACCESS_SESSION_TTL_MS).toISOString();

  const doc: AdminAccessSessionDoc = {
    managerUid: input.managerUid,
    targetType: input.targetType,
    targetId: input.targetId,
    secretHash: hashAdminAccessSessionRaw(raw),
    createdAt,
    expiresAt,
    revoked: false,
  };

  await getDb()
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(sessionId)
    .set(doc);

  return {
    sessionToken: formatAdminAccessSessionToken(sessionId, raw),
    expiresAt,
  };
}

export type AdminAccessSessionValidationFailure =
  | "invalid_token"
  | "not_found"
  | "expired"
  | "revoked"
  | "consumed"
  | "uid_mismatch"
  | "target_mismatch";

export async function validateAdminAccessSession(input: {
  sessionToken: string;
  managerUid: string;
  targetType: AccessPinTargetType;
  targetId: string;
}): Promise<
  | { ok: true; sessionId: string }
  | { ok: false; reason: AdminAccessSessionValidationFailure }
> {
  const parsed = parseAdminAccessSessionToken(input.sessionToken);
  if (!parsed) {
    return { ok: false, reason: "invalid_token" };
  }

  const snap = await getDb()
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(parsed.sessionId)
    .get();
  if (!snap.exists) {
    return { ok: false, reason: "not_found" };
  }

  const session = snap.data() as AdminAccessSessionDoc;
  if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw)) {
    return { ok: false, reason: "invalid_token" };
  }
  if (session.revoked) {
    return { ok: false, reason: "revoked" };
  }
  if (session.consumedAt) {
    return { ok: false, reason: "consumed" };
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (session.managerUid !== input.managerUid) {
    return { ok: false, reason: "uid_mismatch" };
  }
  if (
    session.targetType !== input.targetType ||
    session.targetId !== input.targetId
  ) {
    return { ok: false, reason: "target_mismatch" };
  }

  return { ok: true, sessionId: parsed.sessionId };
}

/** Idempotent revoke — returns true when session transitioned to revoked. */
export async function revokeAdminAccessSessionByToken(
  sessionToken: string,
): Promise<boolean> {
  const parsed = parseAdminAccessSessionToken(sessionToken);
  if (!parsed) return false;

  const ref = getDb()
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(parsed.sessionId);

  let didRevoke = false;
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const session = snap.data() as AdminAccessSessionDoc;
    if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw)) return;
    if (session.revoked || session.consumedAt) return;
    tx.set(
      ref,
      {
        revoked: true,
      },
      { merge: true },
    );
    didRevoke = true;
  });
  return didRevoke;
}

/** Mark session consumed after successful elevated PIN write. */
export async function consumeAdminAccessSessionByToken(
  sessionToken: string,
): Promise<void> {
  const parsed = parseAdminAccessSessionToken(sessionToken);
  if (!parsed) {
    throw new HttpsError("invalid-argument", "Invalid admin access session.");
  }

  const ref = getDb()
    .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
    .doc(parsed.sessionId);
  const consumedAt = new Date().toISOString();

  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "Admin access session expired.");
    }
    const session = snap.data() as AdminAccessSessionDoc;
    if (session.secretHash !== hashAdminAccessSessionRaw(parsed.raw)) {
      throw new HttpsError("permission-denied", "Invalid admin access session.");
    }
    if (session.revoked || session.consumedAt) {
      throw new HttpsError("failed-precondition", "Admin access session expired.");
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw new HttpsError("failed-precondition", "Admin access session expired.");
    }
    tx.set(ref, { consumedAt }, { merge: true });
  });
}
