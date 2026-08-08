"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.managementEntityPinPatch = managementEntityPinPatch;
exports.technicianVendorEntityPinPatch = technicianVendorEntityPinPatch;
exports.prepareAccessPinSecretWrite = prepareAccessPinSecretWrite;
exports.applyAccessPinSecretWriteInTransaction = applyAccessPinSecretWriteInTransaction;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const accessPinCrypto_1 = require("./accessPinCrypto");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const accessPinTargetHelpers_1 = require("./accessPinTargetHelpers");
const managementPinRegistry_1 = require("./managementPinRegistry");
const pinHashing_1 = require("./pinHashing");
function managementEntityPinPatch(now) {
    return {
        pinHash: firestore_1.FieldValue.delete(),
        pinConfigured: true,
        updatedAt: now,
    };
}
function technicianVendorEntityPinPatch(now) {
    return {
        pinConfigured: true,
        pinCode: firestore_1.FieldValue.delete(),
        pinHash: firestore_1.FieldValue.delete(),
        updatedAt: now,
    };
}
function prepareAccessPinSecretWrite(targetType, targetId, pin) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const pinLookupKey = (0, accessPinCrypto_1.pinLookupKeyForPin)(pin);
    return {
        secretRef: db
            .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
            .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, targetId)),
        uniquenessRef: db
            .collection(accessPinSecretsShared_1.ACCESS_PIN_UNIQUENESS_COLLECTION)
            .doc((0, accessPinSecretsShared_1.accessPinUniquenessDocId)(targetType, pinLookupKey)),
        entityRef: (0, accessPinTargetHelpers_1.entityRefForTarget)(targetType, targetId),
        pinHash: (0, pinHashing_1.hashPinForStorage)(pin),
        pinEncrypted: (0, accessPinCrypto_1.encryptPinForStorage)(pin),
        pinLookupKey,
    };
}
/** Secret + uniqueness + entity pinConfigured patch inside an open transaction. */
async function applyAccessPinSecretWriteInTransaction(tx, db, input) {
    const { refs, targetType, targetId, now, pin } = input;
    if (input.uniquenessSnap.exists) {
        const existing = input.uniquenessSnap.data();
        if (existing.targetId && existing.targetId !== targetId) {
            throw new https_1.HttpsError("already-exists", "Could not set PIN.");
        }
    }
    if (input.existingSecretSnap.exists) {
        const oldSecret = input.existingSecretSnap.data();
        if (oldSecret.revealable &&
            oldSecret.pinEncrypted?.ciphertext &&
            oldSecret.pinEncrypted.ciphertext.length > 0) {
            try {
                const oldPin = (0, accessPinCrypto_1.decryptPinFromStorage)(oldSecret.pinEncrypted);
                if (oldPin !== pin) {
                    const oldUniquenessRef = db
                        .collection(accessPinSecretsShared_1.ACCESS_PIN_UNIQUENESS_COLLECTION)
                        .doc((0, accessPinSecretsShared_1.accessPinUniquenessDocId)(targetType, (0, accessPinCrypto_1.pinLookupKeyForPin)(oldPin)));
                    tx.delete(oldUniquenessRef);
                }
            }
            catch {
                // Hash-only or corrupt prior secret — skip old uniqueness cleanup.
            }
        }
    }
    tx.set(refs.secretRef, {
        targetType,
        targetId,
        pinHash: refs.pinHash,
        pinEncrypted: refs.pinEncrypted,
        pinLookupKey: refs.pinLookupKey,
        revealable: true,
        updatedAt: now,
    });
    tx.set(refs.uniquenessRef, {
        targetType,
        targetId,
        updatedAt: now,
    });
    if (targetType === "management") {
        const mgmtBase = input.entitySnap.exists
            ? input.entitySnap.data()
            : {};
        const fields = input.managementEntityFields ?? {};
        tx.set(refs.entityRef, {
            id: targetId,
            label: fields.label ?? mgmtBase.label ?? "Management PIN",
            active: fields.active ?? mgmtBase.active ?? true,
            permissions: fields.permissions
                ? (0, managementPinRegistry_1.normalizeManagementPinPermissions)(fields.permissions)
                : input.entitySnap.exists
                    ? (0, managementPinRegistry_1.normalizeManagementPinPermissions)(mgmtBase.permissions)
                    : (0, managementPinRegistry_1.normalizeManagementPinPermissions)(null),
            createdAt: fields.createdAt ?? mgmtBase.createdAt ?? now,
            ...managementEntityPinPatch(now),
        }, { merge: true });
    }
    else {
        tx.set(refs.entityRef, technicianVendorEntityPinPatch(now), {
            merge: true,
        });
    }
}
//# sourceMappingURL=accessPinSecretWrite.js.map