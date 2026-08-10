"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markVendorDelivered = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyVendorDeliveredReceiving_1 = require("./applyVendorDeliveredReceiving");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const vendorDeliveredItemTruth_1 = require("./vendorDeliveredItemTruth");
function getDb() {
    return admin.firestore();
}
function asActorName(value) {
    if (typeof value !== "string")
        return "Vendor Driver";
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}
/** Server-owned vendor DELIVERED — session, item qty truth, readiness. */
exports.markVendorDelivered = (0, https_1.onCall)({
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
    const actorName = asActorName(data.actorName);
    const lineExceptions = (0, vendorDeliveredItemTruth_1.parseLineExceptions)(data.lineExceptions);
    if (!deliveryId || !sessionToken) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    if (lineExceptions === null) {
        throw new https_1.HttpsError("invalid-argument", "Invalid line exceptions.");
    }
    const result = await (0, applyVendorDeliveredReceiving_1.applyVendorDeliveredReceiving)(getDb(), {
        deliveryId,
        sessionToken,
        actorName,
        lineExceptions,
    });
    return {
        deliveryId: result.deliveryId,
        status: result.status,
        vendorPhysicalDropoffConfirmed: result.vendorPhysicalDropoffConfirmed,
        vendorPhysicalDropoffConfirmedAt: result.vendorPhysicalDropoffConfirmedAt,
        idempotent: result.idempotent,
        itemsUpdated: result.itemsUpdated,
        readiness: result.readiness,
    };
});
//# sourceMappingURL=markVendorDelivered.js.map