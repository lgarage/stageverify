"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePickupToken = void 0;
const admin = require("firebase-admin");
const crypto_1 = require("crypto");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
function getDb() {
    return admin.firestore();
}
async function revokeActiveTokensForJob(jobId, nowIso) {
    const snap = await getDb()
        .collection("pickupTokens")
        .where("jobId", "==", jobId)
        .get();
    const batch = getDb().batch();
    let writes = 0;
    for (const tokenDoc of snap.docs) {
        const data = tokenDoc.data();
        if (!(0, pickupTokenValidation_1.isPickupTokenActive)(data))
            continue;
        batch.update(tokenDoc.ref, { revokedAt: nowIso });
        writes += 1;
    }
    if (writes > 0) {
        await batch.commit();
    }
}
exports.generatePickupToken = (0, https_1.onCall)({
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
    const jobSnap = await getDb().collection("jobs").doc(jobId).get();
    if (!jobSnap.exists) {
        throw new https_1.HttpsError("not-found", "Job not found.");
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const expiresAt = new Date(now + pickupTokenValidation_1.DEFAULT_PICKUP_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await revokeActiveTokensForJob(jobId, nowIso);
    const token = (0, crypto_1.randomBytes)(32).toString("hex");
    const tokenHash = (0, pickupTokenValidation_1.hashPickupToken)(token);
    const createdBy = request.auth.token.email ??
        request.auth.token.name ??
        request.auth.uid;
    await getDb()
        .collection("pickupTokens")
        .doc(tokenHash)
        .set({
        id: tokenHash,
        jobId,
        tokenHash,
        expiresAt,
        revokedAt: null,
        createdBy,
        createdAt: nowIso,
    });
    return {
        token,
        expiresAt,
        jobId,
    };
});
//# sourceMappingURL=generatePickupToken.js.map