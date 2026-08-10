"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markVendorDeliveriesBulk = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const applyVendorDeliveredReceiving_1 = require("./applyVendorDeliveredReceiving");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
function getDb() {
    return admin.firestore();
}
const MAX_BULK_IDS = 50;
function asActorName(value) {
    if (typeof value !== "string")
        return "Vendor Driver";
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : "Vendor Driver";
}
function asDeliveryIdList(value) {
    if (!Array.isArray(value))
        return null;
    const ids = [];
    for (const entry of value) {
        const id = (0, vendorSessionValidation_1.asDeliveryId)(entry);
        if (!id)
            return null;
        if (!ids.includes(id))
            ids.push(id);
    }
    return ids.length > 0 ? ids : null;
}
async function assertVendorScopeSession(sessionToken) {
    const snap = await getDb()
        .collection("vendorSessions")
        .doc(sessionToken)
        .get();
    if (!snap.exists) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
    const session = snap.data();
    if (session.sessionScope !== "vendor" || !session.vendorId) {
        throw new https_1.HttpsError("permission-denied", "Session is not valid for vendor bulk mark.");
    }
    const expiresMs = Date.parse(String(session.expiresAt ?? ""));
    if (!Number.isFinite(expiresMs) || Date.now() >= expiresMs) {
        throw new https_1.HttpsError("permission-denied", "Session expired. Enter your PIN again.");
    }
}
async function markOneDeliveryDelivered(deliveryId, sessionToken, actorName) {
    try {
        // Bulk path is complete-all only (no per-line exceptions in Slice 1).
        const result = await (0, applyVendorDeliveredReceiving_1.applyVendorDeliveredReceiving)(getDb(), {
            deliveryId,
            sessionToken,
            actorName,
            lineExceptions: [],
        });
        return {
            deliveryId,
            success: true,
            status: result.status,
            vendorPhysicalDropoffConfirmed: true,
            idempotent: result.idempotent,
            itemsUpdated: result.itemsUpdated,
        };
    }
    catch (err) {
        const message = err instanceof https_1.HttpsError
            ? err.message
            : err instanceof Error
                ? err.message
                : "Mark delivered failed.";
        return { deliveryId, success: false, error: message };
    }
}
/** Bulk vendor DELIVERED — vendor-scoped sessions; complete-all receiving truth. */
exports.markVendorDeliveriesBulk = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    const deliveryIds = asDeliveryIdList(data.deliveryIds);
    const actorName = asActorName(data.actorName);
    if (!sessionToken || !deliveryIds) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session.");
    }
    if (deliveryIds.length > MAX_BULK_IDS) {
        throw new https_1.HttpsError("invalid-argument", `Too many deliveries (max ${MAX_BULK_IDS}).`);
    }
    await assertVendorScopeSession(sessionToken);
    const results = [];
    for (const deliveryId of deliveryIds) {
        results.push(await markOneDeliveryDelivered(deliveryId, sessionToken, actorName));
    }
    return { results };
});
//# sourceMappingURL=markVendorDeliveriesBulk.js.map