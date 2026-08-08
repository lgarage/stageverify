"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateAccessPins = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const pinHashing_1 = require("./pinHashing");
const COLLECTIONS = [
    { targetType: "technician", name: "technicians" },
    { targetType: "vendor", name: "vendors" },
];
async function migrateCollection(targetType, collectionName, dryRun, remainingLimit) {
    const db = (0, accessPinSecretsShared_1.getDb)();
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
        if (migrated >= remainingLimit)
            break;
        scanned += 1;
        const data = doc.data();
        const hasLegacyPin = (typeof data.pinCode === "string" && data.pinCode.length > 0) ||
            (typeof data.pinHash === "string" && data.pinHash.includes(":"));
        if (!hasLegacyPin)
            continue;
        const secretRef = db
            .collection("accessPinSecrets")
            .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, doc.id));
        const existingSecret = await secretRef.get();
        if (existingSecret.exists) {
            skippedAlreadyMigrated += 1;
            continue;
        }
        const now = new Date().toISOString();
        const hasPlaintext = typeof data.pinCode === "string" && /^\d{4}$/.test(data.pinCode);
        if (hasPlaintext) {
            plaintext += 1;
        }
        else {
            hashOnly += 1;
        }
        if (dryRun) {
            migrated += 1;
            continue;
        }
        await db.runTransaction(async (tx) => {
            const entitySnap = await tx.get(doc.ref);
            if (!entitySnap.exists)
                return;
            const fresh = entitySnap.data();
            const stillHasLegacy = (typeof fresh.pinCode === "string" && fresh.pinCode.length > 0) ||
                (typeof fresh.pinHash === "string" && fresh.pinHash.includes(":"));
            if (!stillHasLegacy)
                return;
            const secretSnap = await tx.get(secretRef);
            if (secretSnap.exists)
                return;
            const plainPin = typeof fresh.pinCode === "string" && /^\d{4}$/.test(fresh.pinCode)
                ? fresh.pinCode
                : null;
            const legacyHash = typeof fresh.pinHash === "string" && fresh.pinHash.includes(":")
                ? fresh.pinHash
                : null;
            if (plainPin) {
                const uniquenessRef = db
                    .collection(accessPinSecretsShared_1.ACCESS_PIN_UNIQUENESS_COLLECTION)
                    .doc((0, accessPinSecretsShared_1.accessPinUniquenessDocId)(targetType, plainPin));
                tx.set(secretRef, {
                    targetType,
                    targetId: doc.id,
                    pinHash: (0, pinHashing_1.hashPinForStorage)(plainPin),
                    pinEncrypted: (0, accessPinCrypto_1.encryptPinForStorage)(plainPin),
                    revealable: true,
                    updatedAt: now,
                });
                tx.set(uniquenessRef, {
                    targetType,
                    targetId: doc.id,
                    updatedAt: now,
                });
            }
            else if (legacyHash) {
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
            }
            else {
                return;
            }
            tx.set(doc.ref, {
                pinConfigured: true,
                pinCode: firestore_1.FieldValue.delete(),
                pinHash: firestore_1.FieldValue.delete(),
                updatedAt: now,
            }, { merge: true });
        });
        migrated += 1;
    }
    return { scanned, migrated, skippedAlreadyMigrated, hashOnly, plaintext };
}
/** Manager migrates legacy entity pinCode/pinHash into accessPinSecrets. */
exports.migrateAccessPins = (0, https_1.onCall)({
    region: "us-central1",
    secrets: [accessPinCrypto_1.accessPinEncryptionKey],
}, async (request) => {
    await (0, dispatcherAuth_1.requireManagerAuth)(request);
    const data = (request.data ?? {});
    const dryRun = data.dryRun === true;
    const limit = (0, dispatcherAuth_1.clampListLimit)(data.limit, 50, 200);
    let remaining = limit;
    let totalScanned = 0;
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalHashOnly = 0;
    let totalPlaintext = 0;
    const byType = {
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
        const result = await migrateCollection(targetType, name, dryRun, remaining);
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
});
//# sourceMappingURL=migrateAccessPins.js.map