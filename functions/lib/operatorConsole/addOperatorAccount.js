"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addOperatorAccount = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
exports.addOperatorAccount = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    const actorUid = await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const targetUid = typeof data.targetUid === "string" ? data.targetUid.trim() : "";
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid is required.");
    }
    const activeCount = await (0, operatorAuth_1.getDb)()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .where("active", "==", true)
        .get();
    if (activeCount.empty) {
        throw new https_1.HttpsError("failed-precondition", "First operator must be bootstrapped via scripts/operator/bootstrap-first-operator.mjs.");
    }
    try {
        await admin.auth().getUser(targetUid);
    }
    catch {
        throw new https_1.HttpsError("not-found", "Target user does not exist in Auth.");
    }
    const existing = await (0, operatorAuth_1.getDb)()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .doc(targetUid)
        .get();
    if (existing.exists && existing.data()?.active === true) {
        throw new https_1.HttpsError("already-exists", "Target user is already an active operator.");
    }
    const now = new Date().toISOString();
    const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
    await (0, operatorAuth_1.getDb)()
        .collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION)
        .doc(targetUid)
        .set({
        active: true,
        displayName: displayName || undefined,
        createdAt: existing.exists
            ? existing.data()?.createdAt ?? now
            : now,
        updatedAt: now,
        createdByUid: actorUid,
    }, { merge: true });
    return { success: true, targetUid };
});
//# sourceMappingURL=addOperatorAccount.js.map