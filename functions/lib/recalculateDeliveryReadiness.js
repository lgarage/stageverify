"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateDeliveryReadiness = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}
function mapApplyError(err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
        throw new https_1.HttpsError("not-found", message);
    }
    if (message.includes("too many line items")) {
        throw new https_1.HttpsError("failed-precondition", message);
    }
    if (message.includes("no items")) {
        throw new https_1.HttpsError("failed-precondition", message);
    }
    throw err instanceof Error ? err : new Error(message);
}
/** Trusted server-owned readiness recalculation — Admin SDK writes only. */
exports.recalculateDeliveryReadiness = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryOrderId = asDeliveryId(data.deliveryOrderId);
    if (!deliveryOrderId) {
        throw new https_1.HttpsError("invalid-argument", "deliveryOrderId is required.");
    }
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (request.auth?.uid) {
        // Dispatcher / authenticated caller
    }
    else if (sessionToken) {
        await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryOrderId);
    }
    else {
        throw new https_1.HttpsError("permission-denied", "Sign in or provide a valid vendor session.");
    }
    try {
        return await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(getDb(), deliveryOrderId);
    }
    catch (err) {
        mapApplyError(err);
    }
});
//# sourceMappingURL=recalculateDeliveryReadiness.js.map