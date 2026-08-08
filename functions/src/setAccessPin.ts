import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  consumeAdminAccessSessionByToken,
  validateAdminAccessSession,
} from "./adminAccessSession";
import {
  accessPinEncryptionKey,
  decryptPinFromStorage,
  encryptPinForStorage,
  pinLookupKeyForPin,
} from "./accessPinCrypto";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  ACCESS_PIN_SET_ATTEMPTS_COLLECTION,
  ACCESS_PIN_UNIQUENESS_COLLECTION,
  PIN_ACCESS_AUDIT_COLLECTION,
  accessPinSecretDocId,
  accessPinUniquenessDocId,
  parseAccessPinTargetType,
  getDb,
  type AccessPinSecretDoc,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import {
  entityRefForTarget,
  targetHasExistingAccessPin,
} from "./accessPinTargetHelpers";
import {
  normalizeManagementPinPermissions,
  type ManagementPinPermissions,
} from "./managementPinRegistry";
import { requireManagerAuth } from "./inboundEmail/dispatcherAuth";
import { asFourDigitPin } from "./pinMatching";
import { hashPinForStorage } from "./pinHashing";

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

function managementEntityPatch(now: string): Record<string, unknown> {
  return {
    pinHash: FieldValue.delete(),
    pinConfigured: true,
    updatedAt: now,
  };
}

function technicianVendorEntityPatch(now: string): Record<string, unknown> {
  return {
    pinConfigured: true,
    pinCode: FieldValue.delete(),
    pinHash: FieldValue.delete(),
    updatedAt: now,
  };
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
    const pin = asFourDigitPin(data.pin);
    const sessionToken =
      typeof data.sessionToken === "string" ? data.sessionToken.trim() : "";

    if (!targetType || !targetId || !pin) {
      throw new HttpsError("invalid-argument", "Invalid PIN access target.");
    }

    const attemptKey = `set:${targetType}:${uid}`;
    await checkSetRateLimit(attemptKey);

    const hasExisting = await targetHasExistingAccessPin(targetType, targetId);

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
    }

    const db = getDb();
    const entityRef = entityRefForTarget(targetType, targetId);
    const secretRef = db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .doc(accessPinSecretDocId(targetType, targetId));
    const pinLookupKey = pinLookupKeyForPin(pin);
    const uniquenessRef = db
      .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
      .doc(accessPinUniquenessDocId(targetType, pinLookupKey));
    const auditRef = db.collection(PIN_ACCESS_AUDIT_COLLECTION).doc();

    const now = new Date().toISOString();
    const pinHash = hashPinForStorage(pin);
    const pinEncrypted = encryptPinForStorage(pin);

    await db.runTransaction(async (tx) => {
      const entitySnap = await tx.get(entityRef);
      if (!entitySnap.exists && targetType !== "management") {
        throw new HttpsError("not-found", "Target not found.");
      }

      const existingSecretSnap = await tx.get(secretRef);
      const uniquenessSnap = await tx.get(uniquenessRef);

      if (uniquenessSnap.exists) {
        const existing = uniquenessSnap.data() as { targetId?: string };
        if (existing.targetId && existing.targetId !== targetId) {
          throw new HttpsError("already-exists", "Could not set PIN.");
        }
      }

      if (existingSecretSnap.exists) {
        const oldSecret = existingSecretSnap.data() as AccessPinSecretDoc;
        if (
          oldSecret.revealable &&
          oldSecret.pinEncrypted?.ciphertext &&
          oldSecret.pinEncrypted.ciphertext.length > 0
        ) {
          try {
            const oldPin = decryptPinFromStorage(oldSecret.pinEncrypted);
            if (oldPin !== pin) {
              const oldUniquenessRef = db
                .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
                .doc(
                  accessPinUniquenessDocId(
                    targetType,
                    pinLookupKeyForPin(oldPin),
                  ),
                );
              tx.delete(oldUniquenessRef);
            }
          } catch {
            // Hash-only or corrupt prior secret — skip old uniqueness cleanup.
          }
        }
      }

      tx.set(secretRef, {
        targetType,
        targetId,
        pinHash,
        pinEncrypted,
        pinLookupKey,
        revealable: true,
        updatedAt: now,
      });
      tx.set(uniquenessRef, {
        targetType,
        targetId,
        updatedAt: now,
      });
      if (targetType === "management") {
        const mgmtBase = entitySnap.exists
          ? (entitySnap.data() as {
              label?: string;
              active?: boolean;
              permissions?: ManagementPinPermissions;
            })
          : {};
        tx.set(
          entityRef,
          {
            id: targetId,
            label: mgmtBase.label ?? "Management PIN",
            active: mgmtBase.active ?? true,
            permissions: entitySnap.exists
              ? normalizeManagementPinPermissions(mgmtBase.permissions)
              : normalizeManagementPinPermissions(null),
            createdAt: entitySnap.exists ? undefined : now,
            ...managementEntityPatch(now),
          },
          { merge: true },
        );
      } else {
        tx.set(entityRef, technicianVendorEntityPatch(now), { merge: true });
      }
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
    });

    if (sessionToken) {
      await consumeAdminAccessSessionByToken(sessionToken);
    }

    return { success: true, targetType, targetId, pinConfigured: true };
  },
);
