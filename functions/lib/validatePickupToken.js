"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePickupToken = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const pickupTokenValidation_1 = require("./pickupTokenValidation");
function getDb() {
    return admin.firestore();
}
exports.validatePickupToken = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const token = (0, pickupTokenValidation_1.asPickupToken)(request.data?.token);
    if (!token) {
        throw new https_1.HttpsError("invalid-argument", "Invalid pickup link.");
    }
    const tokenHash = (0, pickupTokenValidation_1.hashPickupToken)(token);
    const snap = await getDb().collection("pickupTokens").doc(tokenHash).get();
    if (!snap.exists) {
        throw new https_1.HttpsError("not-found", "Invalid or expired pickup link.");
    }
    const data = snap.data();
    if (!(0, pickupTokenValidation_1.isPickupTokenActive)(data)) {
        throw new https_1.HttpsError("permission-denied", "Invalid or expired pickup link.");
    }
    return {
        valid: true,
        jobId: data.jobId,
        expiresAt: data.expiresAt,
    };
});
//# sourceMappingURL=validatePickupToken.js.map