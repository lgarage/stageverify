"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findTechnicianByAccessPinSecrets = findTechnicianByAccessPinSecrets;
exports.findVendorByAccessPinSecrets = findVendorByAccessPinSecrets;
const pinMatching_1 = require("./pinMatching");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
async function findByAccessPinSecrets(targetType, pin, entityGuard, collection) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const snap = await db
        .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
        .where("targetType", "==", targetType)
        .limit(300)
        .get();
    const matches = [];
    for (const secretDoc of snap.docs) {
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
    if (matches.length === 1)
        return matches[0];
    return null;
}
async function findTechnicianByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("technician", pin, (tech) => tech.active !== false && tech.permissions?.doorScan !== false, "technicians");
}
async function findVendorByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("vendor", pin, (vendor) => vendor.active !== false && vendor.companyWideSessionEnabled === true, "vendors");
}
//# sourceMappingURL=accessPinLookup.js.map