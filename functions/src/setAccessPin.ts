import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  hashAdminAccessSessionRaw,
  parseAdminAccessSessionToken,
  validateAdminAccessSession,
  type AdminAccessSessionDoc,
} from "./adminAccessSession";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import {
  applyAccessPinSecretWriteInTransaction,
  prepareAccessPinSecretWrite,
} from "./accessPinSecretWrite";
import {
  ACCESS_PIN_SET_ATTEMPTS_COLLECTION,
  ADMIN_ACCESS_SESSIONS_COLLECTION,
  PIN_ACCESS_AUDIT_COLLECTION,
  parseAccessPinTargetType,
  getDb,
} from "./accessPinSecretsShared";
import {
  targetHasExistingAccessPin,
} from "./accessPinTargetHelpers";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";
import { asAccessPin } from "./pinMatching";

interface SetAccessPinRequest {
  targetType?: string;
  targetId?: string;
  pin?: string;
  sessionToken?: string;
}

const MAX_SET_ATTEMPTS_PER_WINDOW = 8;
const SET_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MIN_SET_ATTEMPT_INTERVAL_MS = 750;

interface PinAttemptDoc {
  count?: number;
  windowStartedAt?: string;
  lastAttemptAt?: string;
}

async function checkSetRateLimit(attemptKey: string): Promise<void> {
  const ref = getDb()
    .collection(ACCESS_PIN_SET_ATTEMPTS_COLLECTION)
    .doc(attemptKey);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : {}) as PinAttemptDoc;
    const windowStart = data.windowStartedAt
      ? Date.parse(data.windowStartedAt)
      : now;
    const inWindow = now - windowStart < SET_ATTEMPT_WINDOW_MS;
    const count = inWindow ? (data.count ?? 0) : 0;

    if (inWindow && count >= MAX_SET_ATTEMPTS_PER_WINDOW) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many PIN set attempts. Try again later.",
      );
    }

    const lastAttempt = data.lastAttemptAt
      ? Date.parse(data.lastAttemptAt)
      : 0;
    if (lastAttempt && now - lastAttempt < MIN_SET_ATTEMPT_INTERVAL_MS) {
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

/** Dispatcher sets access PIN — hash + encrypt in CF-only secrets doc. */
export const setAccessPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    const uid = await requireManagerAuth(request);
    const data = (request.data ?? {}) as SetAccessPinRequest;
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";
    const pin = asAccessPin(data.pin);
    const sessionToken =
      typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";

    if (!targetType || !targetId || !pin) {
      throw new HttpsError("invalid-argument", "Invalid PIN access target.");
    }

    const attemptKey = `set:${targetType}:${uid}`;
    await checkSetRateLimit(attemptKey);

    const hasExisting = await targetHasExistingAccessPin(targetType, targetId);
    let validatedSessionId: string | null = null;
    let validatedSessionRaw: string | null = null;

    if (hasExisting) {
      if (!sessionToken) {
        throw new HttpsError(
          "permission-denied",
          "Admin access session required to change an existing PIN.",
        );
      }
      const sessionCheck = await validateAdminAccessSession({
        sessionToken,
        managerUid: uid,
        targetType,
        targetId,
      });
      if (!sessionCheck.ok) {
        throw new HttpsError(
          "permission-denied",
          "Admin access session invalid or expired.",
        );
      }
      const parsedSession = parseAdminAccessSessionToken(sessionToken);
      if (!parsedSession) {
        throw new HttpsError(
          "permission-denied",
          "Admin access session invalid or expired.",
        );
      }
      validatedSessionId = parsedSession.sessionId;
      validatedSessionRaw = parsedSession.raw;
    }
    // Initial assign: ignore optional sessionToken — do not validate or consume.

    const db = getDb();
    const refs = prepareAccessPinSecretWrite(targetType, targetId, pin);
    const auditRef = db.collection(PIN_ACCESS_AUDIT_COLLECTION).doc();

    const now = new Date().toISOString();

    await db.runTransaction(async (tx) => {
      // ALL reads before ANY writes (incl. session consume for existing-PIN rotate).
      const entitySnap = await tx.get(refs.entityRef);
      if (!entitySnap.exists && targetType !== "management") {
        throw new HttpsError("not-found", "Target not found.");
      }

      const existingSecretSnap = await tx.get(refs.secretRef);
      const uniquenessSnap = await tx.get(refs.uniquenessRef);
      const legacyUniquenessSnaps = await Promise.all(
        refs.legacyUniquenessRefs.map((ref) => tx.get(ref)),
      );

      let sessionRef: FirebaseFirestore.DocumentReference | null = null;
      let sessionSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (validatedSessionId && validatedSessionRaw) {
        sessionRef = db
          .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
          .doc(validatedSessionId);
        sessionSnap = await tx.get(sessionRef);
        if (!sessionSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        const session = sessionSnap.data() as AdminAccessSessionDoc;
        if (
          session.secretHash !== hashAdminAccessSessionRaw(validatedSessionRaw)
        ) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
        if (session.revoked || session.consumedAt) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        if (Date.parse(session.expiresAt) <= Date.now()) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        if (session.managerUid !== uid) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
        if (
          session.targetType !== targetType ||
          session.targetId !== targetId
        ) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
      }

      await applyAccessPinSecretWriteInTransaction(tx, db, {
        targetType,
        targetId,
        pin,
        now,
        refs,
        existingSecretSnap,
        uniquenessSnap,
        legacyUniquenessSnaps,
        entitySnap,
      });

      if (targetType === "management") {
        tx.set(
          db.collection("appSettings").doc("config"),
          {
            managementPinConfigured: true,
            updatedAt: now,
          },
          { merge: true },
        );
      }
      tx.set(auditRef, {
        action: "pin_changed",
        targetType,
        targetId,
        actorUid: uid,
        createdAt: now,
      });

      if (sessionRef) {
        tx.set(sessionRef, { consumedAt: now }, { merge: true });
      }
    });

    return { success: true, targetType, targetId, pinConfigured: true };
  },
);
