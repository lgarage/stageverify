"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asAdminPin = asAdminPin;
exports.adminPinSecretDocId = adminPinSecretDocId;
exports.buildAdminPinSecretDoc = buildAdminPinSecretDoc;
exports.setOwnAdminPin = setOwnAdminPin;
exports.verifyOwnAdminPinForSession = verifyOwnAdminPinForSession;
exports.clearOwnAdminPin = clearOwnAdminPin;
/**
 * Named Admin privileged PIN — hash-only, self-targeted.
 * Never encrypted for reveal; never flows through AccessPinTargetType reveal surface.
 */
const https_1 = require("firebase-functions/v2/https");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const pinHashing_1 = require("./pinHashing");
const pinMatching_1 = require("./pinMatching");
/** Exactly 6 numeric digits — distinct from tech/vendor/management 4–6. */
function asAdminPin(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!/^\d{6}$/.test(trimmed))
        return null;
    return trimmed;
}
function adminPinSecretDocId(uid) {
    return `admin_${uid}`;
}
/** Build hash-only Admin PIN doc (for transactional writes). Never logs PIN. */
function buildAdminPinSecretDoc(uid, pinRaw, updatedAt = new Date().toISOString()) {
    const pin = asAdminPin(pinRaw);
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "Admin PIN must be exactly 6 digits.");
    }
    return {
        targetType: "admin",
        targetId: uid,
        pinHash: (0, pinHashing_1.hashPinForStorage)(pin),
        revealable: false,
        updatedAt,
    };
}
/** Persist caller's Admin PIN (hash-only). targetId always = uid. */
async function setOwnAdminPin(uid, pinRaw) {
    const doc = buildAdminPinSecretDoc(uid, pinRaw);
    await (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc(adminPinSecretDocId(uid))
        .set(doc);
}
/** Verify Admin PIN for the authenticated uid. Never returns PIN material. */
async function verifyOwnAdminPinForSession(uid, pinRaw) {
    const pin = asAdminPin(pinRaw);
    if (!pin)
        return false;
    const snap = await (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc(adminPinSecretDocId(uid))
        .get();
    if (!snap.exists)
        return false;
    const data = snap.data();
    if (typeof data.pinHash !== "string" || data.pinHash.length === 0) {
        return false;
    }
    return (0, pinMatching_1.pinMatches)({ pinHash: data.pinHash }, pin);
}
/** Clear Admin PIN secret when role leaves Admin (fail-closed privilege strip). */
async function clearOwnAdminPin(uid) {
    const ref = (0, accessPinSecretsShared_1.getDb)()
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc(adminPinSecretDocId(uid));
    const snap = await ref.get();
    if (snap.exists) {
        await ref.delete();
    }
}
//# sourceMappingURL=adminPinSecret.js.map