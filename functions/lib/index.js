"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateDeliveryReadiness = exports.resolveMaterialIssue = exports.updatePickupChecklist = exports.recordPickupEvent = exports.validatePickupToken = exports.getPickupTokenStatus = exports.revokePickupToken = exports.generatePickupToken = exports.validateVendorSession = exports.verifyVendorPin = exports.createMaterialIssue = exports.autoSubmitDeliveries = void 0;
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const createMaterialIssue_1 = require("./createMaterialIssue");
Object.defineProperty(exports, "createMaterialIssue", { enumerable: true, get: function () { return createMaterialIssue_1.createMaterialIssue; } });
const verifyVendorPin_1 = require("./verifyVendorPin");
Object.defineProperty(exports, "verifyVendorPin", { enumerable: true, get: function () { return verifyVendorPin_1.verifyVendorPin; } });
const recordPickupEvent_1 = require("./recordPickupEvent");
Object.defineProperty(exports, "recordPickupEvent", { enumerable: true, get: function () { return recordPickupEvent_1.recordPickupEvent; } });
const recalculateDeliveryReadiness_1 = require("./recalculateDeliveryReadiness");
Object.defineProperty(exports, "recalculateDeliveryReadiness", { enumerable: true, get: function () { return recalculateDeliveryReadiness_1.recalculateDeliveryReadiness; } });
const validateVendorSession_1 = require("./validateVendorSession");
Object.defineProperty(exports, "validateVendorSession", { enumerable: true, get: function () { return validateVendorSession_1.validateVendorSession; } });
const generatePickupToken_1 = require("./generatePickupToken");
Object.defineProperty(exports, "generatePickupToken", { enumerable: true, get: function () { return generatePickupToken_1.generatePickupToken; } });
const revokePickupToken_1 = require("./revokePickupToken");
Object.defineProperty(exports, "revokePickupToken", { enumerable: true, get: function () { return revokePickupToken_1.revokePickupToken; } });
const getPickupTokenStatus_1 = require("./getPickupTokenStatus");
Object.defineProperty(exports, "getPickupTokenStatus", { enumerable: true, get: function () { return getPickupTokenStatus_1.getPickupTokenStatus; } });
const validatePickupToken_1 = require("./validatePickupToken");
Object.defineProperty(exports, "validatePickupToken", { enumerable: true, get: function () { return validatePickupToken_1.validatePickupToken; } });
const updatePickupChecklist_1 = require("./updatePickupChecklist");
Object.defineProperty(exports, "updatePickupChecklist", { enumerable: true, get: function () { return updatePickupChecklist_1.updatePickupChecklist; } });
const resolveMaterialIssue_1 = require("./resolveMaterialIssue");
Object.defineProperty(exports, "resolveMaterialIssue", { enumerable: true, get: function () { return resolveMaterialIssue_1.resolveMaterialIssue; } });
admin.initializeApp();
const db = admin.firestore();
const DEFAULT_AUTO_SUBMIT_MINUTES = 30;
exports.autoSubmitDeliveries = (0, scheduler_1.onSchedule)({
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 120,
}, async () => {
    const settingsSnap = await db
        .collection("appSettings")
        .doc("config")
        .get();
    const settings = settingsSnap.exists
        ? settingsSnap.data()
        : {};
    const autoSubmitMs = (settings.autoSubmitMinutes ?? DEFAULT_AUTO_SUBMIT_MINUTES) * 60 * 1000;
    const now = Date.now();
    const cutoffIso = new Date(now - autoSubmitMs).toISOString();
    const snap = await db
        .collection("deliveries")
        .where("status", "==", "arrived")
        .get();
    if (snap.empty)
        return;
    const eligible = snap.docs.filter((d) => {
        const data = d.data();
        if (!data.lastCheckmarkAt)
            return false;
        if (data.submittedAt)
            return false;
        return data.lastCheckmarkAt <= cutoffIso;
    });
    if (eligible.length === 0)
        return;
    for (const deliveryDoc of eligible) {
        const delivery = deliveryDoc.data();
        const deliveryId = deliveryDoc.id;
        const nowIso = new Date(now).toISOString();
        try {
            const itemsSnap = await db
                .collection("items")
                .where("deliveryOrderId", "==", deliveryId)
                .limit(501)
                .get();
            if (itemsSnap.empty || itemsSnap.size > 500)
                continue;
            const items = itemsSnap.docs.map((d) => d.data());
            const anyReceived = items.some((i) => i.qtyReceived > 0);
            if (!anyReceived)
                continue;
            // Query selects status == "arrived"; auto-submit always promotes to partial.
            const submitHistoryId = `event-auto-submit-${crypto.randomUUID()}`;
            const batch = db.batch();
            batch.update(deliveryDoc.ref, {
                status: "partial",
                submittedAt: nowIso,
                updatedAt: nowIso,
            });
            batch.set(db.collection("statusHistory").doc(submitHistoryId), {
                id: submitHistoryId,
                entityType: "delivery_order",
                entityId: deliveryId,
                fromStatus: delivery.status,
                toStatus: "partial",
                reason: "Auto-submitted after inactivity timeout",
                actorType: "system",
                actorName: "Auto-Submit",
                createdAt: nowIso,
            });
            await batch.commit();
            await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(db, deliveryId, {
                historyReason: "Auto-submit readiness recalculation",
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`autoSubmitDeliveries: delivery ${deliveryId} failed — ${message}`);
        }
    }
});
//# sourceMappingURL=index.js.map