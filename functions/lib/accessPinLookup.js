"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findTechnicianByAccessPinSecrets = findTechnicianByAccessPinSecrets;
exports.findVendorByAccessPinSecrets = findVendorByAccessPinSecrets;
const firestore_1 = require("firebase-admin/firestore");
const pinMatching_1 = require("./pinMatching");
const accessPinSecretsShared_1 = require("./accessPinSecretsShared");
const SECRETS_PAGE_SIZE = 300;
async function getAllSecretsForTargetType(targetType) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const allDocs = [];
    let lastDoc;
    while (true) {
        let query = db
            .collection(accessPinSecretsShared_1.ACCESS_PIN_SECRETS_COLLECTION)
            .where("targetType", "==", targetType)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(SECRETS_PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty)
            break;
        allDocs.push(...snap.docs);
        if (snap.docs.length < SECRETS_PAGE_SIZE)
            break;
        lastDoc = snap.docs[snap.docs.length - 1];
    }
    return allDocs;
}
async function findByAccessPinSecrets(targetType, pin, entityGuard, collection) {
    const db = (0, accessPinSecretsShared_1.getDb)();
    const secretDocs = await getAllSecretsForTargetType(targetType);
    const matches = [];
    for (const secretDoc of secretDocs) {
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
    if (matches.length !== 1)
        return null;
    return matches[0];
}
async function findTechnicianByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("technician", pin, (tech) => tech.active !== false && tech.permissions?.doorScan !== false, "technicians");
}
async function findVendorByAccessPinSecrets(pin) {
    return findByAccessPinSecrets("vendor", pin, (vendor) => vendor.active !== false && vendor.companyWideSessionEnabled === true, "vendors");
}
//# sourceMappingURL=accessPinLookup.js.map