import { HttpsError } from "firebase-functions/v2/https";
import {
  hashAdminAccessSessionRaw,
  type AdminAccessSessionDoc,
} from "./adminAccessSession";
import {
  applyAccessPinSecretWriteInTransaction,
  prepareAccessPinSecretWrite,
} from "./accessPinSecretWrite";
import { asAccessPin, pinMatches } from "./pinMatching";
import {
  ACCESS_PIN_SECRETS_COLLECTION,
  ADMIN_ACCESS_SESSIONS_COLLECTION,
  getDb,
  accessPinSecretDocId,
} from "./accessPinSecretsShared";
import type { ManagementPinSessionConsumption } from "./managementPinWriteAuth";

/** Stable id used by setManagementPin back-compat wrapper + legacy migration. */
export const DEFAULT_MANAGEMENT_PIN_ID = "default";

export type ManagementPinCapability =
  | "enterPortalAnyQr"
  | "catchAllCheckIn"
  | "viewWaitingParts"
  | "markOrFlagParcel";

export interface ManagementPinPermissions {
  enterPortalAnyQr?: boolean;
  catchAllCheckIn?: boolean;
  viewWaitingParts?: boolean;
  markOrFlagParcel?: boolean;
}

export type NormalizedManagementPinPermissions =
  Required<ManagementPinPermissions>;

export interface ManagementPinDoc {
  id: string;
  label: string;
  pinHash: string;
  active: boolean;
  permissions: NormalizedManagementPinPermissions;
  createdAt: string;
  updatedAt: string;
  /** True when this pin is the non-persisted legacy singleton view. */
  virtual?: boolean;
}

export function normalizeManagementPinPermissions(
  permissions?: ManagementPinPermissions | null,
): NormalizedManagementPinPermissions {
  return {
    enterPortalAnyQr: permissions?.enterPortalAnyQr !== false,
    catchAllCheckIn: permissions?.catchAllCheckIn !== false,
    viewWaitingParts: permissions?.viewWaitingParts !== false,
    markOrFlagParcel: permissions?.markOrFlagParcel !== false,
  };
}

function asLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

function asPinId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) return null;
  return trimmed;
}

function docFromSnap(
  id: string,
  data: FirebaseFirestore.DocumentData,
): ManagementPinDoc {
  return {
    id,
    label:
      typeof data.label === "string" && data.label.trim()
        ? data.label.trim()
        : "Management PIN",
    pinHash: typeof data.pinHash === "string" ? data.pinHash : "",
    active: data.active !== false,
    permissions: normalizeManagementPinPermissions(
      data.permissions as ManagementPinPermissions | undefined,
    ),
    createdAt:
      typeof data.createdAt === "string"
        ? data.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : new Date().toISOString(),
  };
}

async function loadLegacyPinHash(): Promise<string> {
  const secretSnap = await getDb()
    .collection("managementPinSecrets")
    .doc("config")
    .get();
  const secretHash = (
    secretSnap.data() as { managementPinHash?: string } | undefined
  )?.managementPinHash?.trim();
  if (secretHash) return secretHash;

  const settingsSnap = await getDb()
    .collection("appSettings")
    .doc("config")
    .get();
  return (
    (
      settingsSnap.data() as { managementPinHash?: string } | undefined
    )?.managementPinHash?.trim() ?? ""
  );
}

/** All registry docs (active + inactive) — never mutates. */
export async function listAllManagementPinDocs(): Promise<ManagementPinDoc[]> {
  const snap = await getDb().collection("managementPins").get();
  return snap.docs.map((d) => docFromSnap(d.id, d.data()));
}

/** Active registry docs only — never mutates. */
export async function listActiveManagementPinDocs(): Promise<
  ManagementPinDoc[]
> {
  return (await listAllManagementPinDocs()).filter(
    (p) => p.active && p.pinHash.includes(":"),
  );
}

/** Once any registry doc exists, legacy singleton dual-read is off (D-49 security). */
export async function managementPinRegistryHasDocs(): Promise<boolean> {
  const snap = await getDb().collection("managementPins").limit(1).get();
  return !snap.empty;
}

/**
 * Non-mutating list for Settings.
 * Virtual legacy pin only when managementPins collection is empty and legacy hash exists.
 */
export async function listManagementPinsForSettings(): Promise<
  Array<
    Omit<ManagementPinDoc, "pinHash" | "virtual"> & {
      hasPin: boolean;
      virtual?: boolean;
    }
  >
> {
  const docs = await listAllManagementPinDocs();

  if (docs.length > 0) {
    const withSecretFlags = await Promise.all(
      docs.map(async ({ pinHash: _h, virtual: _v, ...rest }) => {
        let hasSecret = false;
        if (!_h?.includes(":")) {
          const secretSnap = await getDb()
            .collection(ACCESS_PIN_SECRETS_COLLECTION)
            .doc(accessPinSecretDocId("management", rest.id))
            .get();
          hasSecret = secretSnap.exists;
        }
        return {
          ...rest,
          hasPin: Boolean(_h?.includes(":")) || hasSecret,
          virtual: false as const,
        };
      }),
    );
    return withSecretFlags;
  }

  const legacyHash = await loadLegacyPinHash();
  if (!legacyHash.includes(":")) return [];

  const now = new Date().toISOString();
  return [
    {
      id: DEFAULT_MANAGEMENT_PIN_ID,
      label: "Management PIN",
      active: true,
      permissions: normalizeManagementPinPermissions(null),
      createdAt: now,
      updatedAt: now,
      hasPin: true,
      virtual: true,
    },
  ];
}

export async function loadManagementPinById(
  pinId: string,
): Promise<ManagementPinDoc | null> {
  const snap = await getDb().collection("managementPins").doc(pinId).get();
  if (snap.exists) {
    return docFromSnap(snap.id, snap.data() ?? {});
  }

  if (pinId !== DEFAULT_MANAGEMENT_PIN_ID) return null;

  // Virtual legacy only when registry collection is empty (never after first upsert).
  if (await managementPinRegistryHasDocs()) return null;

  const legacyHash = await loadLegacyPinHash();
  if (!legacyHash.includes(":")) return null;

  const now = new Date().toISOString();
  return {
    id: DEFAULT_MANAGEMENT_PIN_ID,
    label: "Management PIN",
    pinHash: legacyHash,
    active: true,
    permissions: normalizeManagementPinPermissions(null),
    createdAt: now,
    updatedAt: now,
    virtual: true,
  };
}

/**
 * Match PIN against active registry pins; if none active, fail closed when
 * registry has any docs (inactive-all must not revive legacy singleton).
 * Legacy dual-read only when managementPins collection is empty.
 */
export async function resolveManagementPinMatch(
  pin: string,
): Promise<ManagementPinDoc | null> {
  // Dynamic import avoids a circular init cycle with accessPinLookup
  // (lookup → loadManagementPinById → registry → findManagement…).
  const { findManagementPinByAccessPinSecrets } = await import(
    "./accessPinLookup"
  );
  const fromSecrets = await findManagementPinByAccessPinSecrets(pin);
  if (fromSecrets) return fromSecrets;

  const all = await listAllManagementPinDocs();
  if (all.length > 0) {
    for (const candidate of all) {
      if (
        candidate.active &&
        candidate.pinHash.includes(":") &&
        pinMatches({ pinHash: candidate.pinHash }, pin)
      ) {
        return candidate;
      }
    }
    return null;
  }

  const legacyHash = await loadLegacyPinHash();
  if (!legacyHash.includes(":")) return null;
  if (!pinMatches({ pinHash: legacyHash }, pin)) return null;

  const now = new Date().toISOString();
  return {
    id: DEFAULT_MANAGEMENT_PIN_ID,
    label: "Management PIN",
    pinHash: legacyHash,
    active: true,
    permissions: normalizeManagementPinPermissions(null),
    createdAt: now,
    updatedAt: now,
    virtual: true,
  };
}

async function assertUniqueActivePin(
  pin: string,
  excludePinId: string | null,
): Promise<void> {
  const active = await listActiveManagementPinDocs();
  for (const candidate of active) {
    if (excludePinId && candidate.id === excludePinId) continue;
    if (pinMatches({ pinHash: candidate.pinHash }, pin)) {
      throw new HttpsError(
        "already-exists",
        "Another active management PIN already uses that code.",
      );
    }
  }

  if (
    !(await managementPinRegistryHasDocs()) &&
    excludePinId !== DEFAULT_MANAGEMENT_PIN_ID
  ) {
    const legacyHash = await loadLegacyPinHash();
    if (
      legacyHash.includes(":") &&
      pinMatches({ pinHash: legacyHash }, pin)
    ) {
      // Migrating the legacy hash into `default` is allowed via setManagementPin /
      // upsert of DEFAULT_MANAGEMENT_PIN_ID only.
      throw new HttpsError(
        "already-exists",
        "Another active management PIN already uses that code.",
      );
    }
  }
}

export interface UpsertManagementPinInput {
  id?: string;
  label?: string;
  pin?: string;
  active?: boolean;
  permissions?: ManagementPinPermissions;
  sessionConsumption?: ManagementPinSessionConsumption | null;
  actorUid?: string;
}

export async function upsertManagementPinDoc(
  input: UpsertManagementPinInput,
): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const requestedId = input.id ? asPinId(input.id) : null;
  const pinId = requestedId ?? `mpin-${Date.now().toString(36)}`;
  const ref = getDb().collection("managementPins").doc(pinId);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? docFromSnap(pinId, existingSnap.data() ?? {})
    : null;

  const pin = input.pin !== undefined ? asAccessPin(input.pin) : null;
  if (input.pin !== undefined && !pin) {
    throw new HttpsError("invalid-argument", "A 4–6 digit PIN is required.");
  }

  const label =
    asLabel(input.label) ??
    existing?.label ??
    (pinId === DEFAULT_MANAGEMENT_PIN_ID ? "Management PIN" : "Office PIN");

  const active =
    typeof input.active === "boolean" ? input.active : (existing?.active ?? true);

  const permissions = normalizeManagementPinPermissions(
    input.permissions ?? existing?.permissions,
  );

  if (!existing && !pin) {
    await ref.set(
      {
        id: pinId,
        label,
        active,
        permissions,
        pinConfigured: false,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { id: pinId };
  }

  if (pin) {
    await assertUniqueActivePin(pin, pinId);

    const db = getDb();
    const refs = prepareAccessPinSecretWrite("management", pinId, pin);
    await db.runTransaction(async (tx) => {
      const [existingSecretSnap, uniquenessSnap, entitySnap] =
        await Promise.all([
          tx.get(refs.secretRef),
          tx.get(refs.uniquenessRef),
          tx.get(refs.entityRef),
        ]);

      await applyAccessPinSecretWriteInTransaction(tx, db, {
        targetType: "management",
        targetId: pinId,
        pin,
        now,
        refs,
        existingSecretSnap,
        uniquenessSnap,
        entitySnap,
        managementEntityFields: {
          label,
          active,
          permissions,
          createdAt: existing?.createdAt ?? now,
        },
      });

      tx.set(
        db.collection("appSettings").doc("config"),
        {
          managementPinConfigured: true,
          updatedAt: now,
        },
        { merge: true },
      );

      if (input.sessionConsumption && input.actorUid) {
        const sessionRef = db
          .collection(ADMIN_ACCESS_SESSIONS_COLLECTION)
          .doc(input.sessionConsumption.sessionId);
        const sessionSnap = await tx.get(sessionRef);
        if (!sessionSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        const session = sessionSnap.data() as AdminAccessSessionDoc;
        if (
          session.secretHash !==
          hashAdminAccessSessionRaw(input.sessionConsumption.raw)
        ) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
        if (session.revoked || session.consumedAt) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        if (Date.parse(session.expiresAt) <= Date.now()) {
          throw new HttpsError(
            "failed-precondition",
            "Admin access session expired.",
          );
        }
        if (session.managerUid !== input.actorUid) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
        if (
          session.targetType !== "management" ||
          session.targetId !== pinId
        ) {
          throw new HttpsError(
            "permission-denied",
            "Invalid admin access session.",
          );
        }
        tx.set(sessionRef, { consumedAt: now }, { merge: true });
      }
    });

    return { id: pinId };
  }

  const pinHash = existing!.pinHash;
  const secretSnap = await getDb()
    .collection("accessPinSecrets")
    .doc(accessPinSecretDocId("management", pinId))
    .get();
  const usesSecrets =
    secretSnap.exists ||
    (existingSnap.data()?.pinConfigured === true && !pinHash.includes(":"));

  if (!usesSecrets && !pinHash.includes(":")) {
    throw new HttpsError("failed-precondition", "PIN hash missing.");
  }

  const patch: Record<string, unknown> = {
    id: pinId,
    label,
    active,
    permissions,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (!usesSecrets) {
    patch.pinHash = pinHash;
  }

  await ref.set(patch, { merge: true });

  await getDb()
    .collection("appSettings")
    .doc("config")
    .set(
      {
        managementPinConfigured: true,
        updatedAt: now,
      },
      { merge: true },
    );

  return { id: pinId };
}

export async function deactivateManagementPinDoc(pinIdRaw: string): Promise<void> {
  const pinId = asPinId(pinIdRaw);
  if (!pinId) {
    throw new HttpsError("invalid-argument", "Invalid PIN id.");
  }
  const ref = getDb().collection("managementPins").doc(pinId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Management PIN not found.");
  }
  await ref.set(
    {
      active: false,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export function pinHasCapability(
  pin: ManagementPinDoc,
  capability: ManagementPinCapability,
): boolean {
  return pin.permissions[capability] === true;
}
