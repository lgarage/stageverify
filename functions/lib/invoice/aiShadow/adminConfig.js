"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminPasswordLockedError = exports.MAX_ADMIN_PASSWORD_LEN = exports.MIN_ADMIN_PASSWORD_LEN = exports.ADMIN_SECRETS_DOC = exports.ADMIN_SECRETS_COLLECTION = void 0;
exports.asAlertEmail = asAlertEmail;
exports.asAdminPassword = asAdminPassword;
exports.readAlertEmailFromSecrets = readAlertEmailFromSecrets;
exports.isAdminPasswordConfigured = isAdminPasswordConfigured;
exports.isAdminFullyConfigured = isAdminFullyConfigured;
exports.storeAdminConfig = storeAdminConfig;
exports.verifyAdminPassword = verifyAdminPassword;
exports.vendorKeyFromImportDoc = vendorKeyFromImportDoc;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const pinHashing_1 = require("../../pinHashing");
const pinMatching_1 = require("../../pinMatching");
exports.ADMIN_SECRETS_COLLECTION = "invoiceTrainingAdminSecrets";
exports.ADMIN_SECRETS_DOC = "config";
exports.MIN_ADMIN_PASSWORD_LEN = 8;
exports.MAX_ADMIN_PASSWORD_LEN = 128;
function getDb() {
    return admin.firestore();
}
function asAlertEmail(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed.length > 254)
        return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))
        return null;
    return trimmed;
}
function asAdminPassword(value) {
    if (typeof value !== "string")
        return null;
    if (value.length < exports.MIN_ADMIN_PASSWORD_LEN)
        return null;
    if (value.length > exports.MAX_ADMIN_PASSWORD_LEN)
        return null;
    return value;
}
async function readAdminSecrets() {
    const snap = await getDb()
        .collection(exports.ADMIN_SECRETS_COLLECTION)
        .doc(exports.ADMIN_SECRETS_DOC)
        .get();
    return snap.data() ?? {};
}
/** Alert email lives in CF-only secrets — never public appSettings. */
async function readAlertEmailFromSecrets() {
    const secrets = await readAdminSecrets();
    return asAlertEmail(secrets.alertEmail);
}
async function isAdminPasswordConfigured() {
    const secrets = await readAdminSecrets();
    return typeof secrets.passwordHash === "string" && secrets.passwordHash.includes(":");
}
async function isAdminFullyConfigured() {
    const alertEmail = await readAlertEmailFromSecrets();
    const passwordConfigured = await isAdminPasswordConfigured();
    return {
        alertEmailConfigured: Boolean(alertEmail),
        passwordConfigured,
        alertEmail,
    };
}
async function storeAdminConfig(input) {
    const now = new Date().toISOString();
    const passwordHash = (0, pinHashing_1.hashPinForStorage)(input.password);
    await getDb()
        .collection(exports.ADMIN_SECRETS_COLLECTION)
        .doc(exports.ADMIN_SECRETS_DOC)
        .set({
        passwordHash,
        alertEmail: input.alertEmail,
        failedAttempts: 0,
        lockUntilMs: 0,
        updatedAt: now,
    }, { merge: true });
    await getDb()
        .collection("appSettings")
        .doc("config")
        .set({
        invoiceTrainingAdminPasswordConfigured: true,
        invoiceTrainingAlertEmailConfigured: true,
        // Never keep plaintext alert email on public-readable appSettings.
        invoiceTrainingAlertEmail: firestore_1.FieldValue.delete(),
        updatedAt: now,
    }, { merge: true });
}
const MAX_ADMIN_PASSWORD_ATTEMPTS = 8;
const ADMIN_LOCK_MS = 15 * 60 * 1000;
class AdminPasswordLockedError extends Error {
    constructor() {
        super("Admin password locked after too many attempts. Try again in 15 minutes.");
        this.name = "AdminPasswordLockedError";
    }
}
exports.AdminPasswordLockedError = AdminPasswordLockedError;
async function verifyAdminPassword(password) {
    const secrets = await readAdminSecrets();
    const nowMs = Date.now();
    if (typeof secrets.lockUntilMs === "number" && secrets.lockUntilMs > nowMs) {
        throw new AdminPasswordLockedError();
    }
    const passwordHash = secrets.passwordHash;
    if (!passwordHash)
        return false;
    const ok = (0, pinMatching_1.pinMatches)({ pinHash: passwordHash }, password);
    if (ok) {
        await getDb()
            .collection(exports.ADMIN_SECRETS_COLLECTION)
            .doc(exports.ADMIN_SECRETS_DOC)
            .set({ failedAttempts: 0, lockUntilMs: 0 }, { merge: true });
        return true;
    }
    const failed = (secrets.failedAttempts ?? 0) + 1;
    const patch = { failedAttempts: failed };
    if (failed >= MAX_ADMIN_PASSWORD_ATTEMPTS) {
        patch.lockUntilMs = nowMs + ADMIN_LOCK_MS;
        patch.failedAttempts = 0;
    }
    await getDb()
        .collection(exports.ADMIN_SECRETS_COLLECTION)
        .doc(exports.ADMIN_SECRETS_DOC)
        .set(patch, { merge: true });
    return false;
}
function vendorKeyFromImportDoc(importDoc) {
    if (typeof importDoc.detectedVendorName === "string" &&
        importDoc.detectedVendorName.trim()) {
        return importDoc.detectedVendorName.trim();
    }
    if (importDoc.parserFormatId === "johnstone")
        return "johnstone";
    return "unknown-vendor";
}
//# sourceMappingURL=adminConfig.js.map