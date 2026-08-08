"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MANAGEMENT_PIN_ID = void 0;
exports.findTechnicianByAccessPinSecrets = findTechnicianByAccessPinSecrets;
exports.findVendorByAccessPinSecrets = findVendorByAccessPinSecrets;
exports.findManagementPinByAccessPinSecrets = findManagementPinByAccessPinSecrets;
const admin = require("firebase-admin");
const accessPinCrypto_1 = require("./accessPinCrypto");
const pinMatching_1 = require("./pinMatching");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const managementPinRegistry_1 = require("./managementPinRegistry");
Object.defineProperty(exports, "DEFAULT_MANAGEMENT_PIN_ID", { enumerable: true, get: function () { return managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID; } });
const SECONDARY_PAGE_SIZE = 300;
const SECONDARY_MAX_BATCHES = 300;
function hasUsablePinLookupKey(secret) {
    return (typeof secret.pinLookupKey === "string" && secret.pinLookupKey.length > 0);
}
/** Hash-only migrated secrets: no indexed pinLookupKey (revealable false). */
function isHashOnlySecret(secret) {
    if (hasUsablePinLookupKey(secret))
        return false;
    return secret.revealable === false || secret.pinLookupKey == null;
}
async function collectSecretMatches(db, secrets, pin, entityGuard, collection, matches) {
    for (const secretDoc of secrets) {
        const secret = secretDoc.data();
        if (!secret.targetId || !secret.pinHash)
            continue;
        if (!(0, pinMatching_1.pinMatches)({ pinHash: secret.pinHash }, pin))
            continue;
        const entitySnap = await db.collection(collection).doc(secret.targetId).get();
        if (!entitySnap.exists)
            continue;
        const entity = entitySnap.data();
        if (!entityGuard(entity))
            continue;
        matches.push({ id: secret.targetId, data: entity });
    }
}
async function collectManagementSecretMatches(db, secrets, pin, matches) {
    for (const secretDoc of secrets) {
        const secret = secretDoc.data();
        if (!secret.targetId || !secret.pinHash)
            continue;
        if (!(0, pinMatching_1.pinMatches)({ pinHash: secret.pinHash }, pin))
            continue;
        const pinDoc = await (0, managementPinRegistry_1.loadManagementPinById)(secret.targetId);
        if (!pinDoc || !pinDoc.active || !pinDoc.pinHash.includes(":"))
            continue;
        matches.push({ id: secret.targetId, data: pinDoc });
    }
}
async function findHashOnlySecretsByPagination(targetType, pin, entityGuard, collection) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const probe = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .where("targetType", "==", targetType)
        .where("revealable", "==", false)
        .limit(1)
        .get();
    if (probe.empty)
        return null;
    const matches = [];
    let lastDoc;
    for (let batch = 0; batch < SECONDARY_MAX_BATCHES; batch += 1) {
        let query = db
            .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
            .where("targetType", "==", targetType)
            .where("revealable", "==", false)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(SECONDARY_PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty)
            break;
        const hashOnlyDocs = snap.docs.filter((secretDoc) => {
            const secret = secretDoc.data();
            if (hasUsablePinLookupKey(secret))
                return false;
            return isHashOnlySecret(secret);
        });
        await collectSecretMatches(db, hashOnlyDocs, pin, entityGuard, collection, matches);
        if (matches.length > 1)
            return null;
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < SECONDARY_PAGE_SIZE)
            break;
    }
    if (matches.length !== 1)
        return null;
    return matches[0];
}
async function findHashOnlyManagementSecretsByPagination(pin) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const targetType = "management";
    const probe = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .where("targetType", "==", targetType)
        .where("revealable", "==", false)
        .limit(1)
        .get();
    if (probe.empty)
        return null;
    const matches = [];
    let lastDoc;
    for (let batch = 0; batch < SECONDARY_MAX_BATCHES; batch += 1) {
        let query = db
            .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
            .where("targetType", "==", targetType)
            .where("revealable", "==", false)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(SECONDARY_PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty)
            break;
        const hashOnlyDocs = snap.docs.filter((secretDoc) => {
            const secret = secretDoc.data();
            if (hasUsablePinLookupKey(secret))
                return false;
            return isHashOnlySecret(secret);
        });
        await collectManagementSecretMatches(db, hashOnlyDocs, pin, matches);
        if (matches.length > 1)
            return null;
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < SECONDARY_PAGE_SIZE)
            break;
    }
    if (matches.length !== 1)
        return null;
    return matches[0];
}
async function findByAccessPinSecrets(targetType, pin, entityGuard, collection) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const key = (0, accessPinCrypto_1.pinLookupKeyForPin)(pin);
    const snap = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .where("targetType", "==", targetType)
        .where("pinLookupKey", "==", key)
        .limit(2)
        .get();
    const hmacMatches = [];
    await collectSecretMatches(db, snap.docs, pin, entityGuard, collection, hmacMatches);
    if (hmacMatches.length === 1)
        return hmacMatches[0];
    if (hmacMatches.length > 1)
        return null;
    return findHashOnlySecretsByPagination(targetType, pin, entityGuard, collection);
}
async function findManagementByAccessPinSecrets(pin) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const key = (0, accessPinCrypto_1.pinLookupKeyForPin)(pin);
    const snap = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .where("targetType", "==", "management")
        .where("pinLookupKey", "==", key)
        .limit(2)
        .get();
    const hmacMatches = [];
    await collectManagementSecretMatches(db, snap.docs, pin, hmacMatches);
    if (hmacMatches.length === 1)
        return hmacMatches[0];
    if (hmacMatches.length > 1)
        return null;
    return findHashOnlyManagementSecretsByPagination(pin);
}
async function findTechnicianByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("technician", pin, (tech) => tech.active !== false && tech.permissions?.doorScan !== false, "technicians");
}
async function findVendorByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("vendor", pin, (vendor) => vendor.active !== false && vendor.companyWideSessionEnabled === true, "vendors");
}
async function findManagementPinByAccessPinSecrets(pin) {
    const match = await findManagementByAccessPinSecrets(pin);
    if (!match)
        return null;
    return match.data;
}
//# sourceMappingURL=accessPinLookup.js.map