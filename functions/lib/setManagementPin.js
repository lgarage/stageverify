"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setManagementPin = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const pinMatching_1 = require("./pinMatching");
const pinHashing_1 = require("./pinHashing");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
function getDb() {
    return admin.firestore();
}
/** Dispatcher sets hashed shared management PIN on appSettings (public-read field). */
exports.setManagementPin = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const pin = (0, pinMatching_1.asFourDigitPin)(request.data?.pin);
    if (!pin) {
        throw new https_1.HttpsError("invalid-argument", "A 4-digit PIN is required.");
    }
    const managementPinHash = (0, pinHashing_1.hashPinForStorage)(pin);
    const now = new Date().toISOString();
    await getDb()
        .collection("managementPinSecrets")
        .doc("config")
        .set({ managementPinHash, updatedAt: now }, { merge: true });
    await getDb()
        .collection("appSettings")
        .doc("config")
        .set({
        managementPinConfigured: true,
        managementPinHash: firestore_1.FieldValue.delete(),
        updatedAt: now,
    }, { merge: true });
    return { success: true };
});
//# sourceMappingURL=setManagementPin.js.map