import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  accessPinEncryptionKey,
  decryptPinFromStorage,
  encryptPinForStorage,
  pinLookupKeyForPin,
} from "./accessPinCrypto";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  ACCESS_PIN_UNIQUENESS_COLLECTION,
  accessPinSecretDocId,
  accessPinUniquenessDocId,
  parseAccessPinTargetType,
  writePinAccessAudit,
  getDb,
  type AccessPinSecretDoc,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import { asFourDigitPin } from "./pinMatching";
import { hashPinForStorage } from "./pinHashing";

interface SetAccessPinRequest {
  targetType?: string;
  targetId?: string;
  pin?: string;
}

const ENTITY_COLLECTION: Record<AccessPinTargetType, string> = {
  technician: "technicians",
  vendor: "vendors",
};

/** Dispatcher sets technician/vendor PIN — hash + encrypt in CF-only secrets doc. */
export const setAccessPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    const uid = await requireDispatcherAuth(request);
    const data = (request.data ?? {}) as SetAccessPinRequest;
    const targetType = parseAccessPinTargetType(data.targetType);
    const targetId =
      typeof data.targetId === "string" ? data.targetId.trim() : "";
    const pin = asFourDigitPin(data.pin);

    if (!targetType || !targetId || !pin) {
      throw new HttpsError("invalid-argument", "Invalid PIN access target.");
    }

    const db = getDb();
    const entityRef = db.collection(ENTITY_COLLECTION[targetType]).doc(targetId);
    const secretRef = db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .doc(accessPinSecretDocId(targetType, targetId));
    const pinLookupKey = pinLookupKeyForPin(pin);
    const uniquenessRef = db
      .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
      .doc(accessPinUniquenessDocId(targetType, pinLookupKey));

    const now = new Date().toISOString();
    const pinHash = hashPinForStorage(pin);
    const pinEncrypted = encryptPinForStorage(pin);

    await db.runTransaction(async (tx) => {
      const entitySnap = await tx.get(entityRef);
      if (!entitySnap.exists) {
        throw new HttpsError("not-found", "Target not found.");
      }

      const existingSecretSnap = await tx.get(secretRef);
      const uniquenessSnap = await tx.get(uniquenessRef);

      if (uniquenessSnap.exists) {
        const existing = uniquenessSnap.data() as { targetId?: string };
        if (existing.targetId && existing.targetId !== targetId) {
          throw new HttpsError(
            "already-exists",
            "Another target already uses this PIN.",
          );
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
      tx.set(
        entityRef,
        {
          pinConfigured: true,
          pinCode: FieldValue.delete(),
          pinHash: FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true },
      );
    });

    await writePinAccessAudit({
      action: "PIN_SET",
      targetType,
      targetId,
      actorUid: uid,
    });

    return { success: true, targetType, targetId, pinConfigured: true };
  },
);
