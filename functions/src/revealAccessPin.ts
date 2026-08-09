import { onCall, HttpsError } from "firebase-functions/v2/https";
import { validateAdminAccessSession } from "./adminAccessSession";
import {
  accessPinEncryptionKey,
  decryptPinFromStorage,
  type PinEncrypted,
} from "./accessPinCrypto";
import {
  accessPinSecretDocId,
  parseAccessPinTargetType,
  writePinAccessAudit,
  writePinAccessAuditBestEffort,
  getDb,
  ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION,
} from "./accessPinSecretsShared";
import { assertAccessPinTargetExists } from "./accessPinTargetHelpers";
import {
  readDispatcherRoleDoc,
  requireAdminAuth,
} from "./inboundEmail/dispatcherAuth";

const REVEALED_FOR_MS = 25_000;
const MAX_ATTEMPTS_PER_WINDOW = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_ATTEMPT_INTERVAL_MS = 750;

interface RevealAccessPinRequest {
  targetType?: string;
  targetId?: string;
  sessionToken?: string;
}

interface PinAttemptDoc {
  count?: number;
  windowStartedAt?: string;
  lastAttemptAt?: string;
}

async function checkRevealRateLimit(attemptKey: string): Promise<void> {
  const ref = getDb()
    .collection(ACCESS_PIN_REVEAL_ATTEMPTS_COLLECTION)
    .doc(attemptKey);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as PinAttemptDoc;
    const windowStart = data.windowStartedAt
      ? Date.parse(data.windowStartedAt)
      : now;
    const inWindow = now - windowStart < ATTEMPT_WINDOW_MS;
    const count = inWindow ? (data.count ?? 0) : 0;

    if (inWindow && count >= MAX_ATTEMPTS_PER_WINDOW) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many reveal attempts. Try again later.",
      );
    }

    const lastAttempt = data.lastAttemptAt
      ? Date.parse(data.lastAttemptAt)
      : 0;
    if (lastAttempt && now - lastAttempt < MIN_ATTEMPT_INTERVAL_MS) {
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

/** Active Admin reveals a configured PIN (25s client auto-hide). Requires live admin session. */
export const revealAccessPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    const data = (request.data ?? {}) as RevealAccessPinRequest;
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";
    const sessionToken =
      typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";

    if (!targetType || !targetId || !sessionToken) {
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
          action: "pin_reveal_denied",
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

    const sessionCheck = await validateAdminAccessSession({
      sessionToken,
      managerUid: uid,
      targetType,
      targetId,
    });
    if (!sessionCheck.ok) {
      await writePinAccessAuditBestEffort({
        action: "pin_reveal_denied",
        targetType,
        targetId,
        actorUid: uid,
      });
      throw new HttpsError(
        "permission-denied",
        "Admin access session invalid or expired.",
      );
    }

    const attemptKey = `reveal:${targetType}:${targetId}:${uid}`;
    await checkRevealRateLimit(attemptKey);

    await assertAccessPinTargetExists(targetType, targetId);

    const db = getDb();
    const secretRef = db
      .collection("accessPinSecrets")
      .doc(accessPinSecretDocId(targetType, targetId));
    const secretSnap = await secretRef.get();
    if (!secretSnap.exists) {
      throw new HttpsError("failed-precondition", "PIN is not configured.");
    }

    const secret = secretSnap.data() as {
      revealable?: boolean;
      pinEncrypted?: PinEncrypted;
    };

    if (secret.revealable !== true) {
      throw new HttpsError(
        "failed-precondition",
        "This PIN was migrated from a hash-only record and cannot be revealed.",
      );
    }

    if (!secret.pinEncrypted) {
      throw new HttpsError("failed-precondition", "PIN is not revealable.");
    }

    let pin: string;
    try {
      pin = decryptPinFromStorage(secret.pinEncrypted);
    } catch (err) {
      console.error("revealAccessPin decrypt failed:", err);
      throw new HttpsError("internal", "Could not reveal PIN.");
    }

    await writePinAccessAudit({
      action: "pin_revealed",
      targetType,
      targetId,
      actorUid: uid,
      actorFullName,
    });

    return { pin, revealedForMs: REVEALED_FOR_MS };
  },
);
