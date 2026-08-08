import { pinMatches } from "./pinMatching";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  getDb,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";

interface TechnicianEntity {
  name?: string;
  active?: boolean;
  permissions?: {
    doorScan?: boolean;
    receiveReleases?: boolean;
  };
}

interface VendorEntity {
  name?: string;
  active?: boolean;
  companyWideSessionEnabled?: boolean;
  pinCode?: string;
  pinHash?: string;
}

async function findByAccessPinSecrets<T extends { active?: boolean }>(
  targetType: AccessPinTargetType,
  pin: string,
  entityGuard: (entity: T) => boolean,
  collection: string,
): Promise<{ id: string; data: T } | null> {
  const db = getDb();
  const snap = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .where("targetType", "==", targetType)
    .limit(300)
    .get();

  const matches: { id: string; data: T }[] = [];

  for (const secretDoc of snap.docs) {
    const secret = secretDoc.data() as { pinHash?: string; targetId?: string };
    if (!secret.targetId || !secret.pinHash) continue;
    if (!pinMatches({ pinHash: secret.pinHash }, pin)) continue;

    const entitySnap = await db.collection(collection).doc(secret.targetId).get();
    if (!entitySnap.exists) continue;
    const entity = entitySnap.data() as T;
    if (!entityGuard(entity)) continue;
    matches.push({ id: secret.targetId, data: entity });
  }

  if (matches.length === 1) return matches[0];
  return null;
}

export async function findTechnicianByAccessPinSecrets(
  pin: string,
): Promise<{ id: string; data: TechnicianEntity } | null> {
  return findByAccessPinSecrets<TechnicianEntity>(
    "technician",
    pin,
    (tech) => tech.active !== false && tech.permissions?.doorScan !== false,
    "technicians",
  );
}

export async function findVendorByAccessPinSecrets(
  pin: string,
): Promise<{ id: string; data: VendorEntity } | null> {
  return findByAccessPinSecrets<VendorEntity>(
    "vendor",
    pin,
    (vendor) =>
      vendor.active !== false && vendor.companyWideSessionEnabled === true,
    "vendors",
  );
}
