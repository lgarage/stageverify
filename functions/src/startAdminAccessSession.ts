import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createAdminAccessSession } from "./adminAccessSession";
import { verifyOwnAdminPinForSession } from "./adminPinSecret";
import {
  ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION,
  getDb,
  parseAccessPinTargetType,
  writePinAccessAudit,
  writePinAccessAuditBestEffort,
} from "./accessPinSecretsShared";
import { assertAccessPinTargetExists } from "./accessPinTargetHelpers";
import {
  readDispatcherRoleDoc,
  requireAdminAuth,
} from "./inboundEmail/dispatcherAuth";

const MAX_ADMIN_PIN_ATTEMPTS_PER_WINDOW = 8;
const ADMIN_PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ADMIN_PIN_ATTEMPT_INTERVAL_MS = 750;

interface StartAdminAccessSessionRequest {
  targetType?: string;
  targetId?: string;
  /** Caller's own 6-digit Admin PIN — authorizing credential, never logged. */
  adminPin?: string;
}

interface PinAttemptDoc {
  count?: number;
  windowStartedAt?: string;
  lastAttemptAt?: string;
}

async function checkAdminPinRateLimit(uid: string): Promise<void> {
  const ref = getDb()
    .collection(ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
    .doc(`adminPinAuth:${uid}`);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as PinAttemptDoc;
    const windowStart = data.windowStartedAt
      ? Date.parse(data.windowStartedAt)
      : now;
    const inWindow = now - windowStart < ADMIN_PIN_ATTEMPT_WINDOW_MS;
    const count = inWindow ? (data.count ?? 0) : 0;

    if (inWindow && count >= MAX_ADMIN_PIN_ATTEMPTS_PER_WINDOW) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many Admin PIN attempts. Try again later.",
      );
    }

    const lastAttempt = data.lastAttemptAt
      ? Date.parse(data.lastAttemptAt)
      : 0;
    if (lastAttempt && now - lastAttempt < MIN_ADMIN_PIN_ATTEMPT_INTERVAL_MS) {
      throw new HttpsError(
        "resource-exhausted",
        "Please wait a moment before trying again.",
      );
    }

    tx.set(
      ref,
      {
        count: inWindow ? count + 1 : 1,
        windowStartedAt: inWindow
          ? (data.windowStartedAt ?? nowIso)
          : nowIso,
        lastAttemptAt: nowIso,
      },
      { merge: true },
    );
  });
}

async function clearAdminPinRateLimit(uid: string): Promise<void> {
  await getDb()
    .collection(ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
    .doc(`adminPinAuth:${uid}`)
    .delete()
    .catch(() => undefined);
}

/** Active Admin + own Admin PIN mints a row-scoped admin access session (5 min TTL). */
export const startAdminAccessSession = onCall(
  { region: "us-central1" },
  async (request) => {
    const data = (request.data ?? {}) as StartAdminAccessSessionRequest;
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";

    if (!targetType || !targetId) {
      throw new HttpsError("invalid-argument", "Invalid PIN access target.");
    }

    let uid: string;
    try {
      uid = await requireAdminAuth(request);
    } catch (err) {
      if (
        err instanceof HttpsError &&
        err.code === "permission-denied" &&
        request.auth?.uid
      ) {
        await writePinAccessAuditBestEffort({
          action: "admin_access_denied",
          targetType,
          targetId,
          actorUid: request.auth.uid,
        });
      }
      throw err;
    }

    const roleDoc = await readDispatcherRoleDoc(uid);
    const actorFullName =
      typeof roleDoc?.fullName === "string" ? roleDoc.fullName : undefined;

    await checkAdminPinRateLimit(uid);

    const pinOk = await verifyOwnAdminPinForSession(uid, data.adminPin);
    if (!pinOk) {
      await writePinAccessAudit({
        action: "admin_access_denied",
        targetType,
        targetId,
        actorUid: uid,
        actorFullName,
      });
      throw new HttpsError(
        "permission-denied",
        "Invalid Admin PIN.",
      );
    }

    await clearAdminPinRateLimit(uid);
    await assertAccessPinTargetExists(targetType, targetId);

    const session = await createAdminAccessSession({
      managerUid: uid,
      targetType,
      targetId,
    });

    await writePinAccessAudit({
      action: "admin_access_granted",
      targetType,
      targetId,
      actorUid: uid,
      actorFullName,
    });

    return {
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
    };
  },
);
