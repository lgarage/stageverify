"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVendorReceiveDetails = void 0;
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
const admin = require("firebase-admin");
function getDb() {
    return admin.firestore();
}
exports.getVendorReceiveDetails = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const deliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.deliveryId);
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const details = await (0, deliveryDetailsResponse_1.hydratePublicDeliveryDetails)(getDb(), deliveryId);
    if (!details) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    return details;
});
//# sourceMappingURL=getVendorReceiveDetails.js.map