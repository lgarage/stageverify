"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivateOperatorAccount = void 0;
const https_1 = require("firebase-functions/v2/https");
const operatorAuth_1 = require("./operatorAuth");
const operatorCollections_1 = require("./operatorCollections");
exports.deactivateOperatorAccount = (0, https_1.onCall)({
    region: "us-central1",
    cors: operatorCollections_1.OPERATOR_CALLABLE_CORS,
}, async (request) => {
    await (0, operatorAuth_1.requireOperatorAuth)(request);
    const data = (request.data ?? {});
    const targetUid = typeof data.targetUid === "string" ? data.targetUid.trim() : "";
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid is required.");
    }
    await (0, operatorAuth_1.assertNotLastActiveOperator)(targetUid);
    const ref = (0, operatorAuth_1.getDb)().collection(operatorCollections_1.OPERATOR_ACCOUNTS_COLLECTION).doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.active !== true) {
        throw new https_1.HttpsError("not-found", "Active operator account not found.");
    }
    const now = new Date().toISOString();
    await ref.set({ active: false, updatedAt: now }, { merge: true });
    return { success: true, targetUid };
});
//# sourceMappingURL=deactivateOperatorAccount.js.map