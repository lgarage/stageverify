"use strict";
/**
 * D-90 Slice 1 — shared vendor Delivered receiving write (single + bulk).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyVendorDeliveredReceiving = applyVendorDeliveredReceiving;
const https_1 = require("firebase-functions/v2/https");
const applyDeliveryReadiness_1 = require("./applyDeliveryReadiness");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const vendorDeliverySpotUtils_1 = require("./vendorDeliverySpotUtils");
const vendorDeliveredItemTruth_1 = require("./vendorDeliveredItemTruth");
async function loadDeliveryItems(db, deliveryId) {
    const snap = await db
        .collection("items")
        .where("deliveryOrderId", "==", deliveryId)
        .get();
    return snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }));
}
function resolveItemTruth(itemId, data, exceptionByItemId) {
    const qtyOrdered = Number(data.qtyOrdered ?? 0);
    if (!Number.isInteger(qtyOrdered) || qtyOrdered < 0) {
        throw new https_1.HttpsError("failed-precondition", "Invalid item ordered quantity.");
    }
    const exception = exceptionByItemId.get(itemId);
    if (exception) {
        try {
            return (0, vendorDeliveredItemTruth_1.computeExceptionItemTruth)(qtyOrdered, exception);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Invalid line exception.";
            throw new https_1.HttpsError("invalid-argument", message);
        }
    }
    return (0, vendorDeliveredItemTruth_1.computeCompleteAllItemTruth)({
        qtyOrdered,
        qtyBackordered: Number(data.qtyBackordered ?? 0),
    });
}
/**
 * Session-asserted Delivered + authoritative item qty writes + readiness recalc.
 * lineExceptions omitted/empty → complete-all for every expected line (preserve prior BO).
 */
async function applyVendorDeliveredReceiving(db, input) {
    const { deliveryId, sessionToken, actorName } = input;
    const lineExceptions = input.lineExceptions ?? [];
    await (0, vendorSessionValidation_1.assertVendorSessionForDelivery)(sessionToken, deliveryId);
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliverySnap = await deliveryRef.get();
    if (!deliverySnap.exists) {
        throw new https_1.HttpsError("not-found", "Delivery not found.");
    }
    const deliveryData = deliverySnap.data();
    if (!(0, vendorDeliverySpotUtils_1.hasAssignableSpot)(deliveryData)) {
        throw new https_1.HttpsError("failed-precondition", "No assigned spot — ask dispatch.");
    }
    const delivery = deliveryData;
    const items = await loadDeliveryItems(db, deliveryId);
    const settingsSnap = await db.collection("appSettings").doc("config").get();
    const vendorDeliveryMode = settingsSnap.exists &&
        settingsSnap.data()?.vendorDeliveryMode === "exception_only"
        ? "exception_only"
        : "full_checkin";
    // full_checkin: qty remains owned by submitVendorCheckin — confirm flags only.
    const receivingTruthEnabled = vendorDeliveryMode === "exception_only";
    const exceptionByItemId = new Map();
    for (const row of lineExceptions) {
        exceptionByItemId.set(row.itemId, row);
    }
    if (!receivingTruthEnabled && exceptionByItemId.size > 0) {
        throw new https_1.HttpsError("failed-precondition", "Line exceptions require exception-only Delivered mode.");
    }
    // Reject exceptions that do not belong to this delivery.
    if (exceptionByItemId.size > 0) {
        const itemIds = new Set(items.map((item) => item.id));
        for (const itemId of exceptionByItemId.keys()) {
            if (!itemIds.has(itemId)) {
                throw new https_1.HttpsError("invalid-argument", "Exception item is not on this delivery.");
            }
        }
    }
    // Idempotent retry: after confirm, empty/omitted exceptions must NOT clobber
    // prior exception qty (missing/damage/BO). Explicit lineExceptions still apply
    // (correction / later-receipt path — Slice 5 cumulative overwrite).
    const txResult = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(deliveryRef);
        if (!freshSnap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const freshData = freshSnap.data();
        if (!(0, vendorDeliverySpotUtils_1.hasAssignableSpot)(freshData)) {
            throw new https_1.HttpsError("failed-precondition", "No assigned spot — ask dispatch.");
        }
        const fresh = freshData;
        const alreadyConfirmed = fresh.vendorPhysicalDropoffConfirmed === true;
        const fromStatus = fresh.status;
        const toStatus = fromStatus === "pending" || fromStatus === "shipped"
            ? "arrived"
            : fromStatus;
        const now = new Date().toISOString();
        const confirmedAt = alreadyConfirmed && fresh.vendorPhysicalDropoffConfirmedAt
            ? fresh.vendorPhysicalDropoffConfirmedAt
            : now;
        const skipQty = !receivingTruthEnabled ||
            (alreadyConfirmed && exceptionByItemId.size === 0);
        const plannedWrites = [];
        if (!skipQty) {
            for (const item of items) {
                const itemRef = db.collection("items").doc(item.id);
                const itemSnap = await tx.get(itemRef);
                if (!itemSnap.exists) {
                    throw new https_1.HttpsError("failed-precondition", "Item missing.");
                }
                const prior = itemSnap.data();
                const truth = resolveItemTruth(item.id, prior, exceptionByItemId);
                plannedWrites.push({ itemId: item.id, prior, truth });
            }
        }
        tx.update(deliveryRef, {
            status: toStatus,
            submittedAt: now,
            vendorPhysicalDropoffConfirmed: true,
            vendorPhysicalDropoffConfirmedAt: confirmedAt,
            deliveredAt: alreadyConfirmed && fresh.deliveredAt ? fresh.deliveredAt : now,
            physicalDropoffSource: "physical_checkin",
            updatedAt: now,
        });
        let itemsUpdated = 0;
        for (const write of plannedWrites) {
            if (!(0, vendorDeliveredItemTruth_1.itemTruthChanged)(write.prior, write.truth))
                continue;
            itemsUpdated += 1;
            tx.update(db.collection("items").doc(write.itemId), {
                qtyReceived: write.truth.qtyReceived,
                qtyMissing: write.truth.qtyMissing,
                qtyDamaged: write.truth.qtyDamaged,
                qtyBackordered: write.truth.qtyBackordered,
                status: write.truth.status,
                updatedAt: now,
            });
        }
        if (fromStatus !== toStatus) {
            const eventId = `event-${crypto.randomUUID()}`;
            tx.set(db.collection("statusHistory").doc(eventId), {
                id: eventId,
                entityType: "delivery_order",
                entityId: deliveryId,
                fromStatus,
                toStatus,
                reason: "Vendor confirmed delivery",
                actorType: "vendor",
                actorName,
                createdAt: now,
            });
        }
        if (itemsUpdated > 0) {
            const historyId = `event-recv-${crypto.randomUUID()}`;
            tx.set(db.collection("statusHistory").doc(historyId), {
                id: historyId,
                entityType: "delivery_order",
                entityId: deliveryId,
                fromStatus: toStatus,
                toStatus,
                reason: "Vendor delivered — receiving updated",
                actorType: "vendor",
                actorName,
                createdAt: now,
                meta: {
                    itemsUpdated,
                    exceptionCount: lineExceptions.length,
                },
            });
        }
        return {
            toStatus,
            fromStatus,
            confirmedAt,
            alreadyConfirmed,
            itemsUpdated,
            skipQty,
        };
    });
    const readiness = await (0, applyDeliveryReadiness_1.applyDeliveryReadinessTransaction)(db, deliveryId, {
        historyReason: "Vendor DELIVERED readiness recalculation",
    });
    return {
        deliveryId,
        status: txResult.toStatus,
        vendorPhysicalDropoffConfirmed: true,
        vendorPhysicalDropoffConfirmedAt: txResult.confirmedAt,
        idempotent: txResult.alreadyConfirmed &&
            txResult.fromStatus === txResult.toStatus &&
            txResult.itemsUpdated === 0,
        itemsUpdated: txResult.itemsUpdated,
        readiness,
    };
}
//# sourceMappingURL=applyVendorDeliveredReceiving.js.map