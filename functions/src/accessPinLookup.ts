import { FieldPath } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
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

const SECRETS_PAGE_SIZE = 300;

async function getAllSecretsForTargetType(
  targetType: AccessPinTargetType,
): Promise<QueryDocumentSnapshot[]> {
  const db = getDb();
  const allDocs: QueryDocumentSnapshot[] = [];
  let lastDoc: QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .where("targetType", "==", targetType)
      .orderBy(FieldPath.documentId())
      .limit(SECRETS_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    allDocs.push(...snap.docs);
    if (snap.docs.length < SECRETS_PAGE_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  return allDocs;
}

async function findByAccessPinSecrets<T extends { active?: boolean }>(
  targetType: AccessPinTargetType,
  pin: string,
  entityGuard: (entity: T) => boolean,
  collection: string,
): Promise<{ id: string; data: T } | null> {
  const db = getDb();
  const secretDocs = await getAllSecretsForTargetType(targetType);
  const matches: { id: string; data: T }[] = [];

  for (const secretDoc of secretDocs) {
    const secret = secretDoc.data() as { pinHash?: string; targetId?: string };
    if (!secret.targetId || !secret.pinHash) continue;
    if (!pinMatches({ pinHash: secret.pinHash }, pin)) continue;

    const entitySnap = await db.collection(collection).doc(secret.targetId).get();
    if (!entitySnap.exists) continue;
    const entity = entitySnap.data() as T;
    if (!entityGuard(entity)) continue;
    matches.push({ id: secret.targetId, data: entity });
  }

  if (matches.length !== 1) return null;
  return matches[0];
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
