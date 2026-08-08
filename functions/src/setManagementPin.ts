import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { accessPinEncryptionKey } from "./accessPinCrypto";
import { asFourDigitPin } from "./pinMatching";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  upsertManagementPinDoc,
} from "./managementPinRegistry";

function getDb() {
  return admin.firestore();
}

interface SetManagementPinRequest {
  pin?: string;
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
    await requireDispatcherAuth(request);
    const pin = asFourDigitPin((request.data as SetManagementPinRequest)?.pin);
    if (!pin) {
      throw new HttpsError("invalid-argument", "A 4-digit PIN is required.");
    }

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
