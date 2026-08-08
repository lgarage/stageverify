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
import {
  DEFAULT_MANAGEMENT_PIN_ID,
  loadLegacyPinHashForMigration,
  managementPinRegistryHasDocs,
  normalizeManagementPinPermissions,
} from "./accessPinMigrateHelpers";
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

type MigrateStats = {
  scanned: number;
  migrated: number;
  skippedAlreadyMigrated: number;
  skippedCollision: number;
  hashOnly: number;
  plaintext: number;
};

const COLLECTIONS: Array<{
  targetType: AccessPinTargetType;
  name: string;
}> = [
  { targetType: "technician", name: "technicians" },
  { targetType: "vendor", name: "vendors" },
];

async function migrateEntityCollection(
  targetType: AccessPinTargetType,
  collectionName: string,
  dryRun: boolean,
  remainingLimit: number,
): Promise<MigrateStats> {
  const db = getDb();
  let scanned = 0;
  let migrated = 0;
  let skippedAlreadyMigrated = 0;
  let skippedCollision = 0;
  let hashOnly = 0;
  let plaintext = 0;

  if (remainingLimit <= 0) {
    return {
      scanned,
      migrated,
      skippedAlreadyMigrated,
      skippedCollision,
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

    const hasPlaintext =
      typeof data.pinCode === "string" && /^\d{4,6}$/.test(data.pinCode);

    if (hasPlaintext) {
      plaintext += 1;
    } else {
      hashOnly += 1;
    }

    if (dryRun) {
      migrated += 1;
      continue;
    }

    let didMigrate = false;
    let collisionSkipped = false;

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
        typeof fresh.pinCode === "string" && /^\d{4,6}$/.test(fresh.pinCode)
          ? fresh.pinCode
          : null;
      const legacyHash =
        typeof fresh.pinHash === "string" && fresh.pinHash.includes(":")
          ? fresh.pinHash
          : null;

      const now = new Date().toISOString();

      if (plainPin) {
        const uniquenessRef = db
          .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
          .doc(
            accessPinUniquenessDocId(
              targetType,
              pinLookupKeyForPin(plainPin),
            ),
          );
        const uniquenessSnap = await tx.get(uniquenessRef);
        if (uniquenessSnap.exists) {
          const existing = uniquenessSnap.data() as { targetId?: string };
          if (existing.targetId && existing.targetId !== doc.id) {
            collisionSkipped = true;
            return;
          }
        }
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
      didMigrate = true;
    });

    if (collisionSkipped) {
      skippedCollision += 1;
      continue;
    }
    if (didMigrate) {
      migrated += 1;
    }
  }

  return {
    scanned,
    migrated,
    skippedAlreadyMigrated,
    skippedCollision,
    hashOnly,
    plaintext,
  };
}

async function migrateManagementPins(
  dryRun: boolean,
  remainingLimit: number,
): Promise<MigrateStats> {
  const db = getDb();
  const stats: MigrateStats = {
    scanned: 0,
    migrated: 0,
    skippedAlreadyMigrated: 0,
    skippedCollision: 0,
    hashOnly: 0,
    plaintext: 0,
  };

  if (remainingLimit <= 0) return stats;

  const registryHasDocs = await managementPinRegistryHasDocs();
  const targets: Array<{ id: string; pinHash: string; label?: string }> = [];

  if (registryHasDocs) {
    const snap = await db.collection("managementPins").limit(500).get();
    for (const doc of snap.docs) {
      const data = doc.data() as { pinHash?: string; label?: string };
      if (typeof data.pinHash === "string" && data.pinHash.includes(":")) {
        targets.push({ id: doc.id, pinHash: data.pinHash, label: data.label });
      }
    }
  } else {
    const legacyHash = await loadLegacyPinHashForMigration();
    if (legacyHash.includes(":")) {
      targets.push({
        id: DEFAULT_MANAGEMENT_PIN_ID,
        pinHash: legacyHash,
        label: "Management PIN",
      });
    }
  }

  for (const target of targets) {
    if (stats.migrated >= remainingLimit) break;
    stats.scanned += 1;

    const secretRef = db
      .collection("accessPinSecrets")
      .doc(accessPinSecretDocId("management", target.id));
    const existingSecret = await secretRef.get();
    if (existingSecret.exists) {
      stats.skippedAlreadyMigrated += 1;
      continue;
    }

    stats.hashOnly += 1;

    if (dryRun) {
      stats.migrated += 1;
      continue;
    }

    const now = new Date().toISOString();
    let didMigrate = false;

    await db.runTransaction(async (tx) => {
      const secretSnap = await tx.get(secretRef);
      if (secretSnap.exists) return;

      tx.set(secretRef, {
        targetType: "management",
        targetId: target.id,
        pinHash: target.pinHash,
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

      if (registryHasDocs) {
        tx.set(
          db.collection("managementPins").doc(target.id),
          {
            pinHash: FieldValue.delete(),
            pinConfigured: true,
            updatedAt: now,
          },
          { merge: true },
        );
      } else if (target.id === DEFAULT_MANAGEMENT_PIN_ID) {
        tx.set(
          db.collection("managementPins").doc(DEFAULT_MANAGEMENT_PIN_ID),
          {
            id: DEFAULT_MANAGEMENT_PIN_ID,
            label: target.label ?? "Management PIN",
            active: true,
            permissions: normalizeManagementPinPermissions(null),
            pinConfigured: true,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      tx.set(
        db.collection("appSettings").doc("config"),
        {
          managementPinConfigured: true,
          updatedAt: now,
        },
        { merge: true },
      );

      didMigrate = true;
    });

    if (didMigrate) {
      stats.migrated += 1;
    }
  }

  return stats;
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
    let totalSkippedCollision = 0;
    let totalHashOnly = 0;
    let totalPlaintext = 0;

    const byType: Record<
      AccessPinTargetType,
      MigrateStats
    > = {
      technician: {
        scanned: 0,
        migrated: 0,
        skippedAlreadyMigrated: 0,
        skippedCollision: 0,
        hashOnly: 0,
        plaintext: 0,
      },
      vendor: {
        scanned: 0,
        migrated: 0,
        skippedAlreadyMigrated: 0,
        skippedCollision: 0,
        hashOnly: 0,
        plaintext: 0,
      },
      management: {
        scanned: 0,
        migrated: 0,
        skippedAlreadyMigrated: 0,
        skippedCollision: 0,
        hashOnly: 0,
        plaintext: 0,
      },
    };

    for (const { targetType, name } of COLLECTIONS) {
      const result = await migrateEntityCollection(
        targetType,
        name,
        dryRun,
        remaining,
      );
      byType[targetType] = result;
      totalScanned += result.scanned;
      totalMigrated += result.migrated;
      totalSkipped += result.skippedAlreadyMigrated;
      totalSkippedCollision += result.skippedCollision;
      totalHashOnly += result.hashOnly;
      totalPlaintext += result.plaintext;
      remaining -= result.migrated;
    }

    const mgmtResult = await migrateManagementPins(dryRun, remaining);
    byType.management = mgmtResult;
    totalScanned += mgmtResult.scanned;
    totalMigrated += mgmtResult.migrated;
    totalSkipped += mgmtResult.skippedAlreadyMigrated;
    totalSkippedCollision += mgmtResult.skippedCollision;
    totalHashOnly += mgmtResult.hashOnly;
    totalPlaintext += mgmtResult.plaintext;

    return {
      dryRun,
      limit,
      scanned: totalScanned,
      migrated: totalMigrated,
      skippedAlreadyMigrated: totalSkipped,
      skippedCollision: totalSkippedCollision,
      hashOnly: totalHashOnly,
      plaintext: totalPlaintext,
      byType,
    };
  },
);
