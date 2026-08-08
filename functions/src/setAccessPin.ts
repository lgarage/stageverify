import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  accessPinEncryptionKey,
  encryptPinForStorage,
} from "./accessPinCrypto";
import {
  accessPinSecretDocId,
  parseAccessPinTargetType,
  writePinAccessAudit,
  getDb,
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
    const entitySnap = await entityRef.get();
    if (!entitySnap.exists) {
      throw new HttpsError("not-found", "Target not found.");
    }

    const now = new Date().toISOString();
    const pinHash = hashPinForStorage(pin);
    const pinEncrypted = encryptPinForStorage(pin);
    const secretRef = db
      .collection("accessPinSecrets")
      .doc(accessPinSecretDocId(targetType, targetId));

    await db.runTransaction(async (tx) => {
      tx.set(secretRef, {
        targetType,
        targetId,
        pinHash,
        pinEncrypted,
        revealable: true,
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
