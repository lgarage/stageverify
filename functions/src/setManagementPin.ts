import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import { asFourDigitPin } from "./pinMatching";
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  upsertManagementPinDoc,
} from "./managementPinRegistry";
import { authorizeManagementPinWrite } from "./managementPinWriteAuth";

function getDb() {
  return admin.firestore();
}

interface SetManagementPinRequest {
  pin?: string;
  sessionToken?: string;
}

/**
 * Back-compat: upserts the stable `default` management PIN with full capabilities.
 * New Settings UI should prefer upsertManagementPin for multi-PIN + matrix.
 */
export const setManagementPin = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    const data = (request.data ?? {}) as SetManagementPinRequest;
    const pin = asFourDigitPin(data.pin);
    if (!pin) {
      throw new HttpsError("invalid-argument", "A 4-digit PIN is required.");
    }

    const auth = await authorizeManagementPinWrite(request, {
      pin,
      id: DEFAULT_MANAGEMENT_PIN_ID,
      fixedTargetId: DEFAULT_MANAGEMENT_PIN_ID,
      sessionToken: data.sessionToken,
    });

    await upsertManagementPinDoc({
      id: DEFAULT_MANAGEMENT_PIN_ID,
      label: "Management PIN",
      pin,
      active: true,
      permissions: {
        enterPortalAnyQr: true,
        catchAllCheckIn: true,
        viewWaitingParts: true,
        markOrFlagParcel: true,
      },
      sessionConsumption: auth.sessionConsumption,
      actorUid: auth.actorUid,
    });

    const now = new Date().toISOString();
    // Keep legacy secret in sync for older readers during dual-read window.
    const defaultSnap = await getDb()
      .collection("managementPins")
      .doc(DEFAULT_MANAGEMENT_PIN_ID)
      .get();
    const pinHash = (defaultSnap.data() as { pinHash?: string } | undefined)
      ?.pinHash;
    if (pinHash) {
      await getDb()
        .collection("managementPinSecrets")
        .doc("config")
        .set({ managementPinHash: pinHash, updatedAt: now }, { merge: true });
    }
    await getDb()
      .collection("appSettings")
      .doc("config")
      .set(
        {
          managementPinConfigured: true,
          managementPinHash: FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true },
      );

    return { success: true };
  },
);
