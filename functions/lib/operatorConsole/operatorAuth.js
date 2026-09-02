"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.requireOperatorAuth = requireOperatorAuth;
exports.isActiveOperator = isActiveOperator;
exports.countActiveOperators = countActiveOperators;
exports.assertNotLastActiveOperator = assertNotLastActiveOperator;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const operatorCollections_1 = require("./operatorCollections");
function getDb() {
    return admin.firestore();
}
/** Fail-closed operator privilege — uid-only via operatorAccounts/{uid}.active === true. */
async function requireOperatorAuth(request) {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = request.auth.uid;
    const snap = await getDb()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .doc(uid)
        .get();
    const data = snap.data();
    if (!snap.exists || data?.active !== true) {
        throw new https_1.HttpsError("permission-denied", "Operator access required.");
    }
    return uid;
}
async function isActiveOperator(uid) {
    const snap = await getDb()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .doc(uid)
        .get();
    const data = snap.data();
    return snap.exists && data?.active === true;
}
async function countActiveOperators() {
    const snap = await getDb()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .where("active", "==", true)
        .get();
    return snap.size;
}
async function assertNotLastActiveOperator(targetUid) {
    const activeCount = await countActiveOperators();
    if (activeCount <= 1) {
        const targetSnap = await getDb()
            .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
            .doc(targetUid)
            .get();
        const targetData = targetSnap.data();
        if (targetSnap.exists && targetData?.active === true) {
            throw new https_1.HttpsError("failed-precondition", "Cannot deactivate the last active operator account.");
        }
    }
}
//# sourceMappingURL=operatorAuth.js.map