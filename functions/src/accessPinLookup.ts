import * as admin from "firebase-admin";
import { pinLookupKeyForPin } from "./accessPinCrypto";
import { pinMatches } from "./pinMatching";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  getDb,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  loadManagementPinById,
  type ManagementPinDoc,
} from "./managementPinRegistry";

const SECONDARY_PAGE_SIZE = 300;
const SECONDARY_MAX_BATCHES = 300;

function hasUsablePinLookupKey(secret: { pinLookupKey?: string }): boolean {
  return (
    typeof secret.pinLookupKey === "string" && secret.pinLookupKey.length > 0
  );
}

/** Hash-only migrated secrets: no indexed pinLookupKey (revealable false). */
function isHashOnlySecret(secret: {
  pinLookupKey?: string;
  revealable?: boolean;
}): boolean {
  if (hasUsablePinLookupKey(secret)) return false;
  return secret.revealable === false || secret.pinLookupKey == null;
}

type SecretFields = {
  pinHash?: string;
  targetId?: string;
  pinLookupKey?: string;
  revealable?: boolean;
};

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

async function collectSecretMatches<T extends { active?: boolean }>(
  db: FirebaseFirestore.Firestore,
  secrets: FirebaseFirestore.QueryDocumentSnapshot[],
  pin: string,
  entityGuard: (entity: T) => boolean,
  collection: string,
  matches: { id: string; data: T }[],
): Promise<void> {
  for (const secretDoc of secrets) {
    const secret = secretDoc.data() as SecretFields;
    if (!secret.targetId || !secret.pinHash) continue;
    if (!pinMatches({ pinHash: secret.pinHash }, pin)) continue;

    const entitySnap = await db.collection(collection).doc(secret.targetId).get();
    if (!entitySnap.exists) continue;
    const entity = entitySnap.data() as T;
    if (!entityGuard(entity)) continue;
    matches.push({ id: secret.targetId, data: entity });
  }
}

async function collectManagementSecretMatches(
  db: FirebaseFirestore.Firestore,
  secrets: FirebaseFirestore.QueryDocumentSnapshot[],
  pin: string,
  matches: { id: string; data: ManagementPinDoc }[],
): Promise<void> {
  for (const secretDoc of secrets) {
    const secret = secretDoc.data() as SecretFields;
    if (!secret.targetId || !secret.pinHash) continue;
    if (!pinMatches({ pinHash: secret.pinHash }, pin)) continue;

    const pinDoc = await loadManagementPinById(secret.targetId);
    if (!pinDoc || !pinDoc.active || !pinDoc.pinHash.includes(":")) continue;
    matches.push({ id: secret.targetId, data: pinDoc });
  }
}

async function findHashOnlySecretsByPagination<T extends { active?: boolean }>(
  targetType: AccessPinTargetType,
  pin: string,
  entityGuard: (entity: T) => boolean,
  collection: string,
): Promise<{ id: string; data: T } | null> {
  const db = getDb();

  const probe = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .where("targetType", "==", targetType)
    .where("revealable", "==", false)
    .limit(1)
    .get();
  if (probe.empty) return null;

  const matches: { id: string; data: T }[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (let batch = 0; batch < SECONDARY_MAX_BATCHES; batch += 1) {
    let query = db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .where("targetType", "==", targetType)
      .where("revealable", "==", false)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SECONDARY_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    const hashOnlyDocs = snap.docs.filter((secretDoc) => {
      const secret = secretDoc.data() as SecretFields;
      if (hasUsablePinLookupKey(secret)) return false;
      return isHashOnlySecret(secret);
    });

    await collectSecretMatches(
      db,
      hashOnlyDocs,
      pin,
      entityGuard,
      collection,
      matches,
    );

    if (matches.length > 1) return null;

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < SECONDARY_PAGE_SIZE) break;
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

async function findHashOnlyManagementSecretsByPagination(
  pin: string,
): Promise<{ id: string; data: ManagementPinDoc } | null> {
  const db = getDb();
  const targetType: AccessPinTargetType = "management";

  const probe = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .where("targetType", "==", targetType)
    .where("revealable", "==", false)
    .limit(1)
    .get();
  if (probe.empty) return null;

  const matches: { id: string; data: ManagementPinDoc }[] = [];
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (let batch = 0; batch < SECONDARY_MAX_BATCHES; batch += 1) {
    let query = db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .where("targetType", "==", targetType)
      .where("revealable", "==", false)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SECONDARY_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    const hashOnlyDocs = snap.docs.filter((secretDoc) => {
      const secret = secretDoc.data() as SecretFields;
      if (hasUsablePinLookupKey(secret)) return false;
      return isHashOnlySecret(secret);
    });

    await collectManagementSecretMatches(db, hashOnlyDocs, pin, matches);

    if (matches.length > 1) return null;

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < SECONDARY_PAGE_SIZE) break;
  }

  if (matches.length !== 1) return null;
  return matches[0];
}

async function findByAccessPinSecrets<T extends { active?: boolean }>(
  targetType: AccessPinTargetType,
  pin: string,
  entityGuard: (entity: T) => boolean,
  collection: string,
): Promise<{ id: string; data: T } | null> {
  const db = getDb();
  const key = pinLookupKeyForPin(pin);
  const snap = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .where("targetType", "==", targetType)
    .where("pinLookupKey", "==", key)
    .limit(2)
    .get();

  const hmacMatches: { id: string; data: T }[] = [];
  await collectSecretMatches(
    db,
    snap.docs,
    pin,
    entityGuard,
    collection,
    hmacMatches,
  );

  if (hmacMatches.length === 1) return hmacMatches[0];
  if (hmacMatches.length > 1) return null;

  return findHashOnlySecretsByPagination(
    targetType,
    pin,
    entityGuard,
    collection,
  );
}

async function findManagementByAccessPinSecrets(
  pin: string,
): Promise<{ id: string; data: ManagementPinDoc } | null> {
  const db = getDb();
  const key = pinLookupKeyForPin(pin);
  const snap = await db
    .collection(ACCESS_PIN_SECRETS_COLLECTION)
    .where("targetType", "==", "management")
    .where("pinLookupKey", "==", key)
    .limit(2)
    .get();

  const hmacMatches: { id: string; data: ManagementPinDoc }[] = [];
  await collectManagementSecretMatches(db, snap.docs, pin, hmacMatches);

  if (hmacMatches.length === 1) return hmacMatches[0];
  if (hmacMatches.length > 1) return null;

  return findHashOnlyManagementSecretsByPagination(pin);
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

export async function findManagementPinByAccessPinSecrets(
  pin: string,
): Promise<ManagementPinDoc | null> {
  const match = await findManagementByAccessPinSecrets(pin);
  if (!match) return null;
  return match.data;
}

export { DEFAULT_MANAGEMENT_PIN_ID };
