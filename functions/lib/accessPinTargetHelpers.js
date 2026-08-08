"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAccessPinTargetExists = assertAccessPinTargetExists;
exports.targetHasExistingAccessPin = targetHasExistingAccessPin;
exports.entityCollectionForTargetType = entityCollectionForTargetType;
exports.entityRefForTarget = entityRefForTarget;
const https_1 = require("firebase-functions/v2/https");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const managementPinRegistry_1 = require("./managementPinRegistry");
const ENTITY_COLLECTION = {
    technician: "technicians",
    vendor: "vendors",
};
async function assertAccessPinTargetExists(targetType, targetId) {
    if (targetType === "management") {
        const pin = await (0, managementPinRegistry_1.loadManagementPinById)(targetId);
        if (!pin) {
            throw new https_1.HttpsError("not-found", "Target not found.");
        }
        return;
    }
    const snap = await (0, accessPinSecretsShared_1.getDb)()
        .collection(ENTITY_COLLECTION[targetType])
        .doc(targetId)
        .get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Target not found.");
    }
}
/** True when CF secret or legacy entity PIN exists — initial assign allowed only when false. */
async function targetHasExistingAccessPin(targetType, targetId) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const secretSnap = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .doc((0, accessPinSecretsShared_1.accessPinSecretDocId)(targetType, targetId))
        .get();
    if (secretSnap.exists)
        return true;
    if (targetType === "management") {
        const pin = await (0, managementPinRegistry_1.loadManagementPinById)(targetId);
        if (!pin)
            return false;
        if (typeof pin.pinHash === "string" && pin.pinHash.includes(":")) {
            return true;
        }
        if (targetId === managementPinRegistry_1.DEFAULT_MANAGEMENT_PIN_ID) {
            const legacySecret = await db
                .collection("managementPinSecrets")
                .doc("config")
                .get();
            const legacyHash = legacySecret.data()?.managementPinHash;
            if (typeof legacyHash === "string" && legacyHash.includes(":")) {
                return true;
            }
            const settingsSnap = await db.collection("appSettings").doc("config").get();
            const settingsHash = settingsSnap.data()?.managementPinHash;
            if (typeof settingsHash === "string" && settingsHash.includes(":")) {
                return true;
            }
        }
        return false;
    }
    const entitySnap = await db
        .collection(ENTITY_COLLECTION[targetType])
        .doc(targetId)
        .get();
    if (!entitySnap.exists)
        return false;
    const data = entitySnap.data();
    if (typeof data.pinCode === "string" && data.pinCode.length > 0)
        return true;
    if (typeof data.pinHash === "string" && data.pinHash.includes(":")) {
        return true;
    }
    return false;
}
function entityCollectionForTargetType(targetType) {
    if (targetType === "management")
        return "managementPins";
    return ENTITY_COLLECTION[targetType];
}
function entityRefForTarget(targetType, targetId) {
    return (0, accessPinSecretsShared_1.getDb)()
        .collection(entityCollectionForTargetType(targetType))
        .doc(targetId);
}
//# sourceMappingURL=accessPinTargetHelpers.js.map