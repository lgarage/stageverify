import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { asFourDigitPin } from "./pinMatching";
import { hashPinForStorage } from "./pinHashing";
import { requireDispatcherAuth } from "./inboundEmail/dispatcherAuth";

function getDb() {
  return admin.firestore();
}

interface SetManagementPinRequest {
  pin?: string;
}

/** Dispatcher sets hashed shared management PIN on appSettings (public-read field). */
export const setManagementPin = onCall(
  { region: "us-central1" },
  async (request) => {
    await requireDispatcherAuth(request);
    const pin = asFourDigitPin((request.data as SetManagementPinRequest)?.pin);
    if (!pin) {
      throw new HttpsError("invalid-argument", "A 4-digit PIN is required.");
    }

    const managementPinHash = hashPinForStorage(pin);
    const now = new Date().toISOString();
    await getDb()
      .collection("managementPinSecrets")
      .doc("config")
      .set({ managementPinHash, updatedAt: now }, { merge: true });
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
