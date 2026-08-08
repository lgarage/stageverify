import * as admin from "firebase-admin";
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  normalizeManagementPinPermissions,
} from "./managementPinRegistry";

function getDb() {
  return admin.firestore();
}

export { DEFAULT_MANAGEMENT_PIN_ID, normalizeManagementPinPermissions };

export async function managementPinRegistryHasDocs(): Promise<boolean> {
  const snap = await getDb().collection("managementPins").limit(1).get();
  return !snap.empty;
}

/** Legacy singleton hash for migration — leaves managementPinSecrets untouched. */
export async function loadLegacyPinHashForMigration(): Promise<string> {
  const secretSnap = await getDb()
    .collection("managementPinSecrets")
    .doc("config")
    .get();
  const secretHash = (
    secretSnap.data() as { managementPinHash?: string } | undefined
  )?.managementPinHash?.trim();
  if (secretHash) return secretHash;

  const settingsSnap = await getDb().collection("appSettings").doc("config").get();
  return (
    (
      settingsSnap.data() as { managementPinHash?: string } | undefined
    )?.managementPinHash?.trim() ?? ""
  );
}
