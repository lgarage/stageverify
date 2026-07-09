"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocationPublicBranding = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
function asLocationCode(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32)
        return null;
    return trimmed;
}
/** Pre-PIN location header — non-sensitive branding only (Phase 3). */
exports.getLocationPublicBranding = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const locationCode = asLocationCode(request.data?.locationCode);
    if (!locationCode) {
        throw new https_1.HttpsError("invalid-argument", "Invalid location code.");
    }
    const snap = await getDb()
        .collection("stagingLocations")
        .where("code", "==", locationCode)
        .limit(1)
        .get();
    if (snap.empty) {
        return { found: false };
    }
    const doc = snap.docs[0];
    const data = doc.data();
    return {
        found: true,
        locationId: doc.id,
        code: String(data.code ?? locationCode),
        label: typeof data.label === "string" && data.label.trim()
            ? data.label.trim()
            : locationCode,
        type: typeof data.type === "string" && data.type.trim()
            ? data.type.trim()
            : "other",
    };
});
//# sourceMappingURL=getLocationPublicBranding.js.map