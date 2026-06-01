"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoSubmitDeliveries = void 0;
const admin = require("firebase-admin");
const scheduler_1 = require("firebase-functions/v2/scheduler");
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
    // Query arrived deliveries where vendor started checking items
    const snap = await db
        .collection("deliveries")
        .where("status", "==", "arrived")
        .get();
    if (snap.empty)
        return;
    const eligible = snap.docs.filter((d) => {
        const data = d.data();
        // Must have lastCheckmarkAt set (vendor started), not yet submitted, and past cutoff
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
        const nowIso = new Date(now).toISOString();
        const itemsSnap = await db
            .collection("items")
            .where("deliveryOrderId", "==", delivery.id)
            .get();
        const items = itemsSnap.docs.map((d) => d.data());
        const allReceived = items.length > 0 &&
            items.every((i) => i.qtyReceived >= i.qtyOrdered);
        const overallStatus = allReceived
            ? "ready_for_pickup"
            : "partial";
        const eventId = `event-auto-${delivery.id}-${now}`;
        const batch = db.batch();
        batch.update(deliveryDoc.ref, {
            status: overallStatus,
            submittedAt: nowIso,
            updatedAt: nowIso,
        });
        batch.set(db.collection("statusHistory").doc(eventId), {
            id: eventId,
            entityType: "delivery_order",
            entityId: delivery.id,
            fromStatus: delivery.status,
            toStatus: overallStatus,
            reason: "Auto-submitted after inactivity timeout",
            actorType: "system",
            actorName: "Auto-Submit",
            createdAt: nowIso,
        });
        await batch.commit();
    }
});
//# sourceMappingURL=index.js.map