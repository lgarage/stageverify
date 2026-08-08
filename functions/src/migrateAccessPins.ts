import { FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  accessPinEncryptionKey,
  encryptPinForStorage,
  pinLookupKeyForPin,
} from "./accessPinCrypto";
import {
  accessPinSecretDocId,
  accessPinUniquenessDocId,
  ACCESS_PIN_UNIQUENESS_COLLECTION,
  getDb,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import { clampListLimit, requireManagerAuth } from "./inboundEmail/dispatcherAuth";
import { hashPinForStorage } from "./pinHashing";

interface MigrateAccessPinsRequest {
  dryRun?: boolean;
  limit?: number;
}

type EntityPinFields = {
  pinCode?: string;
  pinHash?: string;
};

const COLLECTIONS: Array<{
  targetType: AccessPinTargetType;
  name: string;
}> = [
  { targetType: "technician", name: "technicians" },
  { targetType: "vendor", name: "vendors" },
];

async function migrateCollection(
  targetType: AccessPinTargetType,
  collectionName: string,
  dryRun: boolean,
  remainingLimit: number,
): Promise<{
  scanned: number;
  migrated: number;
  skippedAlreadyMigrated: number;
  hashOnly: number;
  plaintext: number;
}> {
  const db = getDb();
  let scanned = 0;
  let migrated = 0;
  let skippedAlreadyMigrated = 0;
  let hashOnly = 0;
  let plaintext = 0;

  if (remainingLimit <= 0) {
    return {
      scanned,
      migrated,
      skippedAlreadyMigrated,
      hashOnly,
      plaintext,
    };
  }

  const snap = await db.collection(collectionName).limit(500).get();

  for (const doc of snap.docs) {
    if (migrated >= remainingLimit) break;
    scanned += 1;

    const data = doc.data() as EntityPinFields & { pinConfigured?: boolean };
    const hasLegacyPin =
      (typeof data.pinCode === "string" && data.pinCode.length > 0) ||
      (typeof data.pinHash === "string" && data.pinHash.includes(":"));

    if (!hasLegacyPin) continue;

    const secretRef = db
      .collection("accessPinSecrets")
      .doc(accessPinSecretDocId(targetType, doc.id));
    const existingSecret = await secretRef.get();
    if (existingSecret.exists) {
      skippedAlreadyMigrated += 1;
      continue;
    }

    const now = new Date().toISOString();
    const hasPlaintext =
      typeof data.pinCode === "string" && /^\d{4}$/.test(data.pinCode);

    if (hasPlaintext) {
      plaintext += 1;
    } else {
      hashOnly += 1;
    }

    if (dryRun) {
      migrated += 1;
      continue;
    }

    await db.runTransaction(async (tx) => {
      const entitySnap = await tx.get(doc.ref);
      if (!entitySnap.exists) return;
      const fresh = entitySnap.data() as EntityPinFields;
      const stillHasLegacy =
        (typeof fresh.pinCode === "string" && fresh.pinCode.length > 0) ||
        (typeof fresh.pinHash === "string" && fresh.pinHash.includes(":"));
      if (!stillHasLegacy) return;

      const secretSnap = await tx.get(secretRef);
      if (secretSnap.exists) return;

      const plainPin =
        typeof fresh.pinCode === "string" && /^\d{4}$/.test(fresh.pinCode)
          ? fresh.pinCode
          : null;
      const legacyHash =
        typeof fresh.pinHash === "string" && fresh.pinHash.includes(":")
          ? fresh.pinHash
          : null;

      if (plainPin) {
        const uniquenessRef = db
          .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
          .doc(accessPinUniquenessDocId(targetType, plainPin));
        tx.set(secretRef, {
          targetType,
          targetId: doc.id,
          pinHash: hashPinForStorage(plainPin),
          pinEncrypted: encryptPinForStorage(plainPin),
          pinLookupKey: pinLookupKeyForPin(plainPin),
          revealable: true,
          updatedAt: now,
        });
        tx.set(uniquenessRef, {
          targetType,
          targetId: doc.id,
          updatedAt: now,
        });
      } else if (legacyHash) {
        tx.set(secretRef, {
          targetType,
          targetId: doc.id,
          pinHash: legacyHash,
          pinEncrypted: {
            alg: "AES-GCM",
            iv: "",
            ciphertext: "",
            tag: "",
            keyVersion: 0,
          },
          revealable: false,
          updatedAt: now,
        });
      } else {
        return;
      }

      tx.set(
        doc.ref,
        {
          pinConfigured: true,
          pinCode: FieldValue.delete(),
          pinHash: FieldValue.delete(),
          updatedAt: now,
        },
        { merge: true },
      );
    });

    migrated += 1;
  }

  return { scanned, migrated, skippedAlreadyMigrated, hashOnly, plaintext };
}

/** Manager migrates legacy entity pinCode/pinHash into accessPinSecrets. */
export const migrateAccessPins = onCall(
  {
    region: "us-central1",
    secrets: [accessPinEncryptionKey],
  },
  async (request) => {
    await requireManagerAuth(request);
    const data = (request.data ?? {}) as MigrateAccessPinsRequest;
    const dryRun = data.dryRun === true;
    const limit = clampListLimit(data.limit, 50, 200);

    let remaining = limit;
    let totalScanned = 0;
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalHashOnly = 0;
    let totalPlaintext = 0;

    const byType: Record<
      AccessPinTargetType,
      {
        scanned: number;
        migrated: number;
        skippedAlreadyMigrated: number;
        hashOnly: number;
        plaintext: number;
      }
    > = {
      technician: {
        scanned: 0,
        migrated: 0,
        skippedAlreadyMigrated: 0,
        hashOnly: 0,
        plaintext: 0,
      },
      vendor: {
        scanned: 0,
        migrated: 0,
        skippedAlreadyMigrated: 0,
        hashOnly: 0,
        plaintext: 0,
      },
    };

    for (const { targetType, name } of COLLECTIONS) {
      const result = await migrateCollection(
        targetType,
        name,
        dryRun,
        remaining,
      );
      byType[targetType] = {
        scanned: result.scanned,
        migrated: result.migrated,
        skippedAlreadyMigrated: result.skippedAlreadyMigrated,
        hashOnly: result.hashOnly,
        plaintext: result.plaintext,
      };
      totalScanned += result.scanned;
      totalMigrated += result.migrated;
      totalSkipped += result.skippedAlreadyMigrated;
      totalHashOnly += result.hashOnly;
      totalPlaintext += result.plaintext;
      remaining -= result.migrated;
    }

    return {
      dryRun,
      limit,
      scanned: totalScanned,
      migrated: totalMigrated,
      skippedAlreadyMigrated: totalSkipped,
      hashOnly: totalHashOnly,
      plaintext: totalPlaintext,
      byType,
    };
  },
);
