"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateVendorSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
exports.validateVendorSession = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    const deliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.deliveryId);
    if (!sessionToken || !deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    const session = await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    return {
        valid: true,
        deliveryId: session.deliveryId,
        vendorId: session.vendorId,
        vendorName: session.vendorName,
        expiresAt: session.expiresAt,
    };
});
//# sourceMappingURL=validateVendorSession.js.map