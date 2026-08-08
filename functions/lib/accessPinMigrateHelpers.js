"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeManagementPinPermissions = exports.DEFAULT_MANAGEMENT_PIN_ID = void 0;
exports.managementPinRegistryHasDocs = managementPinRegistryHasDocs;
exports.loadLegacyPinHashForMigration = loadLegacyPinHashForMigration;
const admin = require("firebase-admin");
const managementPinRegistry_1 = require("./managementPinRegistry");
Object.defineProperty(exports, "DEFAULT_MANAGEMENT_PIN_ID", { enumerable: true, get: function () { return managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID; } });
Object.defineProperty(exports, "normalizeManagementPinPermissions", { enumerable: true, get: function () { return managementPinRegistry_1.normalizeManagementPinPermissions; } });
function getDb() {
    return admin.firestore();
}
async function managementPinRegistryHasDocs() {
    const snap = await getDb().collection("managementPins").limit(1).get();
    return !snap.empty;
}
/** Legacy singleton hash for migration — leaves managementPinSecrets untouched. */
async function loadLegacyPinHashForMigration() {
    const secretSnap = await getDb()
        .collection("managementPinSecrets")
        .doc("config")
        .get();
    const secretHash = secretSnap.data()?.managementPinHash?.trim();
    if (secretHash)
        return secretHash;
    const settingsSnap = await getDb().collection("appSettings").doc("config").get();
    return (settingsSnap.data()?.managementPinHash?.trim() ?? "");
}
//# sourceMappingURL=accessPinMigrateHelpers.js.map