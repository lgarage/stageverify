"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPickupTokenStatus = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
function getDb() {
    return admin.firestore();
}
exports.getPickupTokenStatus = (0, https_1.onCall)({
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
    const snap = await getDb()
        .collection("pickupTokens")
        .where("jobId", "==", jobId)
        .get();
    let active = null;
    for (const tokenDoc of snap.docs) {
        const data = tokenDoc.data();
        if (!(0, pickupTokenValidation_1.isPickupTokenActive)(data))
            continue;
        if (!active ||
            Date.parse(data.createdAt) > Date.parse(active.createdAt)) {
            active = data;
        }
    }
    if (!active) {
        return { hasActiveToken: false };
    }
    return {
        hasActiveToken: true,
        expiresAt: active.expiresAt,
        createdAt: active.createdAt,
        createdBy: active.createdBy,
    };
});
//# sourceMappingURL=getPickupTokenStatus.js.map