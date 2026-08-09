import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  decryptPinFromStorage,
  encryptPinForStorage,
  pinLookupKeyForPin,
} from "./accessPinCrypto";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  ACCESS_PIN_UNIQUENESS_COLLECTION,
  ACCESS_PIN_UNIQUENESS_TARGET_TYPES,
  accessPinSecretDocId,
  accessPinUniquenessDocId,
  getDb,
  legacyAccessPinUniquenessDocId,
  uniquenessBelongsToOtherTarget,
  type AccessPinSecretDoc,
  type AccessPinTargetType,
} from "./accessPinSecretsShared";
import { entityRefForTarget } from "./accessPinTargetHelpers";
import {
  normalizeManagementPinPermissions,
  type ManagementPinPermissions,
} from "./managementPinRegistry";
import { hashPinForStorage } from "./pinHashing";

export function managementEntityPinPatch(
  now: string,
): Record<string, unknown> {
  return {
    pinHash: FieldValue.delete(),
    pinConfigured: true,
    updatedAt: now,
  };
}

export function technicianVendorEntityPinPatch(
  now: string,
): Record<string, unknown> {
  return {
    pinConfigured: true,
    pinCode: FieldValue.delete(),
    pinHash: FieldValue.delete(),
    updatedAt: now,
  };
}

export interface PreparedAccessPinSecretWrite {
  secretRef: FirebaseFirestore.DocumentReference;
  uniquenessRef: FirebaseFirestore.DocumentReference;
  /** Pre–D-74 typed uniqueness refs for every AccessPinTargetType (dual-check). */
  legacyUniquenessRefs: FirebaseFirestore.DocumentReference[];
  entityRef: FirebaseFirestore.DocumentReference;
  pinHash: string;
  pinEncrypted: ReturnType<typeof encryptPinForStorage>;
  pinLookupKey: string;
}

export function prepareAccessPinSecretWrite(
  targetType: AccessPinTargetType,
  targetId: string,
  pin: string,
): PreparedAccessPinSecretWrite {
  const db = getDb();
  const pinLookupKey = pinLookupKeyForPin(pin);
  return {
    secretRef: db
      .collection(ACCESS_PIN_SECRETS_COLLECTION)
      .doc(accessPinSecretDocId(targetType, targetId)),
    uniquenessRef: db
      .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
      .doc(accessPinUniquenessDocId(pinLookupKey)),
    legacyUniquenessRefs: ACCESS_PIN_UNIQUENESS_TARGET_TYPES.map((type) =>
      db
        .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
        .doc(legacyAccessPinUniquenessDocId(type, pinLookupKey)),
    ),
    entityRef: entityRefForTarget(targetType, targetId),
    pinHash: hashPinForStorage(pin),
    pinEncrypted: encryptPinForStorage(pin),
    pinLookupKey,
  };
}

export { uniquenessBelongsToOtherTarget };

export interface ApplyAccessPinSecretWriteInput {
  targetType: AccessPinTargetType;
  targetId: string;
  pin: string;
  now: string;
  refs: PreparedAccessPinSecretWrite;
  existingSecretSnap: FirebaseFirestore.DocumentSnapshot;
  uniquenessSnap: FirebaseFirestore.DocumentSnapshot;
  legacyUniquenessSnaps: FirebaseFirestore.DocumentSnapshot[];
  entitySnap: FirebaseFirestore.DocumentSnapshot;
  managementEntityFields?: {
    label?: string;
    active?: boolean;
    permissions?: ManagementPinPermissions;
    createdAt?: string;
  };
}

/** Secret + uniqueness + entity pinConfigured patch inside an open transaction. */
export async function applyAccessPinSecretWriteInTransaction(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: ApplyAccessPinSecretWriteInput,
): Promise<void> {
  const { refs, targetType, targetId, now, pin } = input;

  if (
    uniquenessBelongsToOtherTarget(
      input.uniquenessSnap.exists
        ? (input.uniquenessSnap.data() as {
            targetId?: string;
            targetType?: AccessPinTargetType;
          })
        : undefined,
      targetType,
      targetId,
    )
  ) {
    throw new HttpsError("already-exists", "Could not set PIN.");
  }

  for (const legacySnap of input.legacyUniquenessSnaps) {
    if (!legacySnap.exists) continue;
    if (
      uniquenessBelongsToOtherTarget(
        legacySnap.data() as {
          targetId?: string;
          targetType?: AccessPinTargetType;
        },
        targetType,
        targetId,
      )
    ) {
      throw new HttpsError("already-exists", "Could not set PIN.");
    }
  }

  if (input.existingSecretSnap.exists) {
    const oldSecret = input.existingSecretSnap.data() as AccessPinSecretDoc;
    if (
      oldSecret.revealable &&
      oldSecret.pinEncrypted?.ciphertext &&
      oldSecret.pinEncrypted.ciphertext.length > 0
    ) {
      try {
        const oldPin = decryptPinFromStorage(oldSecret.pinEncrypted);
        if (oldPin !== pin) {
          const oldKey = pinLookupKeyForPin(oldPin);
          const oldGlobalRef = db
            .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
            .doc(accessPinUniquenessDocId(oldKey));
          const oldGlobalSnap = await tx.get(oldGlobalRef);
          if (
            oldGlobalSnap.exists &&
            !uniquenessBelongsToOtherTarget(
              oldGlobalSnap.data() as {
                targetId?: string;
                targetType?: AccessPinTargetType;
              },
              targetType,
              targetId,
            )
          ) {
            tx.delete(oldGlobalRef);
          }
          for (const type of ACCESS_PIN_UNIQUENESS_TARGET_TYPES) {
            const legacyRef = db
              .collection(ACCESS_PIN_UNIQUENESS_COLLECTION)
              .doc(legacyAccessPinUniquenessDocId(type, oldKey));
            const legacySnap = await tx.get(legacyRef);
            if (
              legacySnap.exists &&
              !uniquenessBelongsToOtherTarget(
                legacySnap.data() as {
                  targetId?: string;
                  targetType?: AccessPinTargetType;
                },
                targetType,
                targetId,
              )
            ) {
              tx.delete(legacyRef);
            }
          }
        }
      } catch {
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
      ? (input.entitySnap.data() as {
          label?: string;
          active?: boolean;
          permissions?: ManagementPinPermissions;
          createdAt?: string;
        })
      : {};
    const fields = input.managementEntityFields ?? {};
    tx.set(
      refs.entityRef,
      {
        id: targetId,
        label: fields.label ?? mgmtBase.label ?? "Management PIN",
        active: fields.active ?? mgmtBase.active ?? true,
        permissions: fields.permissions
          ? normalizeManagementPinPermissions(fields.permissions)
          : input.entitySnap.exists
            ? normalizeManagementPinPermissions(mgmtBase.permissions)
            : normalizeManagementPinPermissions(null),
        createdAt: fields.createdAt ?? mgmtBase.createdAt ?? now,
        ...managementEntityPinPatch(now),
      },
      { merge: true },
    );
  } else {
    tx.set(refs.entityRef, technicianVendorEntityPinPatch(now), {
      merge: true,
    });
  }
}
