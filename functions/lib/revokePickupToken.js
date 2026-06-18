"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revokePickupToken = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
function getDb() {
    return admin.firestore();
}
exports.revokePickupToken = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Sign in required.");
    }
    const jobId = (0, pickupTokenValidation_1.asJobId)(request.data?.jobId);
    if (!jobId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid job.");
    }
    const nowIso = new Date().toISOString();
    const snap = await getDb()
        .collection("pickupTokens")
        .where("jobId", "==", jobId)
        .get();
    const batch = getDb().batch();
    let revoked = 0;
    for (const tokenDoc of snap.docs) {
        const data = tokenDoc.data();
        if (!(0, pickupTokenValidation_1.isPickupTokenActive)(data))
            continue;
        batch.update(tokenDoc.ref, { revokedAt: nowIso });
        revoked += 1;
    }
    if (revoked > 0) {
        await batch.commit();
    }
    return { success: true, revokedCount: revoked };
});
//# sourceMappingURL=revokePickupToken.js.map