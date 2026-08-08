import { HttpsError } from "firebase-functions/v2/https";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  accessPinSecretDocId,
  getDb,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  loadManagementPinById,
} from "./managementPinRegistry";

const ENTITY_COLLECTION: Record<
  Exclude<AccessPinTargetType, "management">,
  string
> = {
  technician: "technicians",
  vendor: "vendors",
};

type LegacyPinFields = {
  pinCode?: string;
  pinHash?: string;
  pinConfigured?: boolean;
};

export async function assertAccessPinTargetExists(
  targetType: AccessPinTargetType,
  targetId: string,
): Promise<void> {
  if (targetType === "management") {
    const pin = await loadManagementPinById(targetId);
    if (!pin) {
      throw new HttpsError("not-found", "Target not found.");
    }
    return;
  }

  const snap = await getDb()
    .collection(ENTITY_COLLECTION[targetType])
    .doc(targetId)
    .get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Target not found.");
  }
}

/** True when CF secret or legacy entity PIN exists — initial assign allowed only when false. */
export async function targetHasExistingAccessPin(
  targetType: AccessPinTargetType,
  targetId: string,
): Promise<boolean> {
  const db = getDb();
  const secretSnap = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .doc(accessPinSecretDocId(targetType, targetId))
    .get();
  if (secretSnap.exists) return true;

  if (targetType === "management") {
    const pin = await loadManagementPinById(targetId);
    if (!pin) return false;
    if (typeof pin.pinHash === "string" && pin.pinHash.includes(":")) {
      return true;
    }
    if (targetId === DEFAULT_MANAGEMENT_PIN_ID) {
      const legacySecret = await db
        .collection("managementPinSecrets")
        .doc("config")
        .get();
      const legacyHash = (
        legacySecret.data() as { managementPinHash?: string } | undefined
      )?.managementPinHash;
      if (typeof legacyHash === "string" && legacyHash.includes(":")) {
        return true;
      }
      const settingsSnap = await db.collection("appSettings").doc("config").get();
      const settingsHash = (
        settingsSnap.data() as { managementPinHash?: string } | undefined
      )?.managementPinHash;
      if (typeof settingsHash === "string" && settingsHash.includes(":")) {
        return true;
      }
    }
    return false;
  }

  const entitySnap = await db
    .collection(ENTITY_COLLECTION[targetType])
    .doc(targetId)
    .get();
  if (!entitySnap.exists) return false;
  const data = entitySnap.data() as LegacyPinFields;
  if (typeof data.pinCode === "string" && data.pinCode.length > 0) return true;
  if (typeof data.pinHash === "string" && data.pinHash.includes(":")) {
    return true;
  }
  return false;
}

export function entityCollectionForTargetType(
  targetType: AccessPinTargetType,
): string {
  if (targetType === "management") return "managementPins";
  return ENTITY_COLLECTION[targetType];
}

export function entityRefForTarget(
  targetType: AccessPinTargetType,
  targetId: string,
) {
  return getDb()
    .collection(entityCollectionForTargetType(targetType))
    .doc(targetId);
}
