"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MANAGEMENT_PIN_ID = void 0;
exports.normalizeManagementPinPermissions = normalizeManagementPinPermissions;
exports.listAllManagementPinDocs = listAllManagementPinDocs;
exports.listActiveManagementPinDocs = listActiveManagementPinDocs;
exports.managementPinRegistryHasDocs = managementPinRegistryHasDocs;
exports.listManagementPinsForSettings = listManagementPinsForSettings;
exports.loadManagementPinById = loadManagementPinById;
exports.resolveManagementPinMatch = resolveManagementPinMatch;
exports.upsertManagementPinDoc = upsertManagementPinDoc;
exports.deactivateManagementPinDoc = deactivateManagementPinDoc;
exports.pinHasCapability = pinHasCapability;
const https_1 = require("firebase-functions/v2/https");
const adminAccessSession_1 = require("./adminAccessSession");
const accessPinSecretWrite_1 = require("./accessPinSecretWrite");
const pinMatching_1 = require("./pinMatching");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
/** Stable id used by setManagementPin back-compat wrapper + legacy migration. */
exports.DEFAULT_MANAGEMENT_PIN_ID = "default";
function normalizeManagementPinPermissions(permissions) {
    return {
        enterPortalAnyQr: permissions?.enterPortalAnyQr !== false,
        catchAllCheckIn: permissions?.catchAllCheckIn !== false,
        viewWaitingParts: permissions?.viewWaitingParts !== false,
        markOrFlagParcel: permissions?.markOrFlagParcel !== false,
    };
}
function asLabel(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 64)
        return null;
    return trimmed;
}
function asPinId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed))
        return null;
    return trimmed;
}
function docFromSnap(id, data) {
    return {
        id,
        label: typeof data.label === "string" && data.label.trim()
            ? data.label.trim()
            : "Management PIN",
        pinHash: typeof data.pinHash === "string" ? data.pinHash : "",
        active: data.active !== false,
        permissions: normalizeManagementPinPermissions(data.permissions),
        createdAt: typeof data.createdAt === "string"
            ? data.createdAt
            : new Date().toISOString(),
        updatedAt: typeof data.updatedAt === "string"
            ? data.updatedAt
            : new Date().toISOString(),
    };
}
async function loadLegacyPinHash() {
    const secretSnap = await (0, accessPinSecretsShared_1.getDb)()
        .collection("managementPinSecrets")
        .doc("config")
        .get();
    const secretHash = secretSnap.data()?.managementPinHash?.trim();
    if (secretHash)
        return secretHash;
    const settingsSnap = await (0, accessPinSecretsShared_1.getDb)()
        .collection("appSettings")
        .doc("config")
        .get();
    return (settingsSnap.data()?.managementPinHash?.trim() ?? "");
}
/** All registry docs (active + inactive) — never mutates. */
async function listAllManagementPinDocs() {
    const snap = await (0, accessPinSecretsShared_1.getDb)().collection("managementPins").get();
    return snap.docs.map((d) => docFromSnap(d.id, d.data()));
}
/** Active registry docs only — never mutates. */
async function listActiveManagementPinDocs() {
    return (await listAllManagementPinDocs()).filter((p) => p.active && p.pinHash.includes(":"));
}
/** Once any registry doc exists, legacy singleton dual-read is off (D-49 security). */
async function managementPinRegistryHasDocs() {
    const snap = await (0, accessPinSecretsShared_1.getDb)().collection("managementPins").limit(1).get();
    return !snap.empty;
}
/**
 * Non-mutating list for Settings.
 * Virtual legacy pin only when managementPins collection is empty and legacy hash exists.
 */
async function listManagementPinsForSettings() {
    const docs = await listAllManagementPinDocs();
    if (docs.length > 0) {
        const withSecretFlags = await Promise.all(docs.map(async ({ pinHash: _h, virtual: _v, ...rest }) => {
            let hasSecret = false;
            if (!_h?.includes(":")) {
                const secretSnap = await (0, accessPinSecretsShared_1.getDb)()
                    .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
                    .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)("management", rest.id))
                    .get();
                hasSecret = secretSnap.exists;
            }
            return {
                ...rest,
                hasPin: Boolean(_h?.includes(":")) || hasSecret,
                virtual: false,
            };
        }));
        return withSecretFlags;
    }
    const legacyHash = await loadLegacyPinHash();
    if (!legacyHash.includes(":"))
        return [];
    const now = new Date().toISOString();
    return [
        {
            id: exports.DEFAULT_MANAGEMENT_PIN_ID,
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
async function loadManagementPinById(pinId) {
    const snap = await (0, accessPinSecretsShared_1.getDb)().collection("managementPins").doc(pinId).get();
    if (snap.exists) {
        return docFromSnap(snap.id, snap.data() ?? {});
    }
    if (pinId !== exports.DEFAULT_MANAGEMENT_PIN_ID)
        return null;
    // Virtual legacy only when registry collection is empty (never after first upsert).
    if (await managementPinRegistryHasDocs())
        return null;
    const legacyHash = await loadLegacyPinHash();
    if (!legacyHash.includes(":"))
        return null;
    const now = new Date().toISOString();
    return {
        id: exports.DEFAULT_MANAGEMENT_PIN_ID,
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
async function resolveManagementPinMatch(pin) {
    // Dynamic import avoids a circular init cycle with accessPinLookup
    // (lookup → loadManagementPinById → registry → findManagement…).
    const { findManagementPinByAccessPinSecrets } = await Promise.resolve().then(() => require("./accessPinLookup"));
    const fromSecrets = await findManagementPinByAccessPinSecrets(pin);
    if (fromSecrets)
        return fromSecrets;
    const all = await listAllManagementPinDocs();
    if (all.length > 0) {
        for (const candidate of all) {
            if (candidate.active &&
                candidate.pinHash.includes(":") &&
                (0, pinMatching_1.pinMatches)({ pinHash: candidate.pinHash }, pin)) {
                return candidate;
            }
        }
        return null;
    }
    const legacyHash = await loadLegacyPinHash();
    if (!legacyHash.includes(":"))
        return null;
    if (!(0, pinMatching_1.pinMatches)({ pinHash: legacyHash }, pin))
        return null;
    const now = new Date().toISOString();
    return {
        id: exports.DEFAULT_MANAGEMENT_PIN_ID,
        label: "Management PIN",
        pinHash: legacyHash,
        active: true,
        permissions: normalizeManagementPinPermissions(null),
        createdAt: now,
        updatedAt: now,
        virtual: true,
    };
}
async function assertUniqueActivePin(pin, excludePinId) {
    const active = await listActiveManagementPinDocs();
    for (const candidate of active) {
        if (excludePinId && candidate.id === excludePinId)
            continue;
        if ((0, pinMatching_1.pinMatches)({ pinHash: candidate.pinHash }, pin)) {
            throw new https_1.HttpsError("already-exists", "Another active management PIN already uses that code.");
        }
    }
    if (!(await managementPinRegistryHasDocs()) &&
        excludePinId !== exports.DEFAULT_MANAGEMENT_PIN_ID) {
        const legacyHash = await loadLegacyPinHash();
        if (legacyHash.includes(":") &&
            (0, pinMatching_1.pinMatches)({ pinHash: legacyHash }, pin)) {
            // Migrating the legacy hash into `default` is allowed via setManagementPin /
            // upsert of DEFAULT_MANAGEMENT_PIN_ID only.
            throw new https_1.HttpsError("already-exists", "Another active management PIN already uses that code.");
        }
    }
}
async function upsertManagementPinDoc(input) {
    const now = new Date().toISOString();
    const requestedId = input.id ? asPinId(input.id) : null;
    const pinId = requestedId ?? `mpin-${Date.now().toString(36)}`;
    const ref = (0, accessPinSecretsShared_1.getDb)().collection("managementPins").doc(pinId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists
        ? docFromSnap(pinId, existingSnap.data() ?? {})
        : null;
    const pin = input.pin !== undefined ? (0, pinMatching_1.asAccessPin)(input.pin) : null;
    if (input.pin !== undefined && !pin) {
        throw new https_1.HttpsError("invalid-argument", "A 4–6 digit PIN is required.");
    }
    const label = asLabel(input.label) ??
        existing?.label ??
        (pinId === exports.DEFAULT_MANAGEMENT_PIN_ID ? "Management PIN" : "Office PIN");
    const active = typeof input.active === "boolean" ? input.active : (existing?.active ?? true);
    const permissions = normalizeManagementPinPermissions(input.permissions ?? existing?.permissions);
    if (!existing && !pin) {
        await ref.set({
            id: pinId,
            label,
            active,
            permissions,
            pinConfigured: false,
            createdAt: now,
            updatedAt: now,
        }, { merge: true });
        return { id: pinId };
    }
    if (pin) {
        await assertUniqueActivePin(pin, pinId);
        const db = (0, accessPinSecretsShared_1.getDb)();
        const refs = (0, accessPinSecretWrite_1.prepareAccessPinSecretWrite)("management", pinId, pin);
        await db.runTransaction(async (tx) => {
            // ALL reads before ANY writes (incl. session consume when rotating).
            const sessionRef = input.sessionConsumption && input.actorUid
                ? db
                    .collection(accessPinSecretsShared_1.ADMIN_ACCESS_SESSIONS_COLLECTION)
                    .doc(input.sessionConsumption.sessionId)
                : null;
            const [existingSecretSnap, uniquenessSnap, entitySnap, sessionSnap, ...legacyUniquenessSnaps] = await Promise.all([
                tx.get(refs.secretRef),
                tx.get(refs.uniquenessRef),
                tx.get(refs.entityRef),
                sessionRef ? tx.get(sessionRef) : Promise.resolve(null),
                ...refs.legacyUniquenessRefs.map((ref) => tx.get(ref)),
            ]);
            if (sessionRef && input.sessionConsumption && input.actorUid) {
                if (!sessionSnap?.exists) {
                    throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
                }
                const session = sessionSnap.data();
                if (session.secretHash !==
                    (0, adminAccessSession_1.hashAdminAccessSessionRaw)(input.sessionConsumption.raw)) {
                    throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
                }
                if (session.revoked || session.consumedAt) {
                    throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
                }
                if (Date.parse(session.expiresAt) <= Date.now()) {
                    throw new https_1.HttpsError("failed-precondition", "Admin access session expired.");
                }
                if (session.managerUid !== input.actorUid) {
                    throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
                }
                if (session.targetType !== "management" ||
                    session.targetId !== pinId) {
                    throw new https_1.HttpsError("permission-denied", "Invalid admin access session.");
                }
            }
            await (0, accessPinSecretWrite_1.applyAccessPinSecretWriteInTransaction)(tx, db, {
                targetType: "management",
                targetId: pinId,
                pin,
                now,
                refs,
                existingSecretSnap,
                uniquenessSnap,
                legacyUniquenessSnaps,
                entitySnap,
                managementEntityFields: {
                    label,
                    active,
                    permissions,
                    createdAt: existing?.createdAt ?? now,
                },
            });
            tx.set(db.collection("appSettings").doc("config"), {
                managementPinConfigured: true,
                updatedAt: now,
            }, { merge: true });
            if (sessionRef) {
                tx.set(sessionRef, { consumedAt: now }, { merge: true });
            }
        });
        return { id: pinId };
    }
    const pinHash = existing.pinHash;
    const secretSnap = await (0, accessPinSecretsShared_1.getDb)()
        .collection("accessPinSecrets")
        .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)("management", pinId))
        .get();
    const usesSecrets = secretSnap.exists ||
        (existingSnap.data()?.pinConfigured === true && !pinHash.includes(":"));
    if (!usesSecrets && !pinHash.includes(":")) {
        throw new https_1.HttpsError("failed-precondition", "PIN hash missing.");
    }
    const patch = {
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
    await (0, accessPinSecretsShared_1.getDb)()
        .collection("appSettings")
        .doc("config")
        .set({
        managementPinConfigured: true,
        updatedAt: now,
    }, { merge: true });
    return { id: pinId };
}
async function deactivateManagementPinDoc(pinIdRaw) {
    const pinId = asPinId(pinIdRaw);
    if (!pinId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid PIN id.");
    }
    const ref = (0, accessPinSecretsShared_1.getDb)().collection("managementPins").doc(pinId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Management PIN not found.");
    }
    await ref.set({
        active: false,
        updatedAt: new Date().toISOString(),
    }, { merge: true });
}
function pinHasCapability(pin, capability) {
    return pin.permissions[capability] === true;
}
//# sourceMappingURL=managementPinRegistry.js.map