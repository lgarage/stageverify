"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.releasePlannedStagingLocation = void 0;
/**
 * Vendor planned-spot release — session-gated (location-first D4).
 * "No" removes from plannedStagingLocationIds + audit entry.
 * "Yes" assigns the spot as actual (same occupancy rules as assignVendorStagingLocation).
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const deliveryDetailsResponse_1 = require("./deliveryDetailsResponse");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const stagingOccupancyGuard_1 = require("./stagingOccupancyGuard");
function getDb() {
    return admin.firestore();
}
function asStagingLocationId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asPlacedFlag(value) {
    return value === true;
}
function deliveryUsesStagingLocation(delivery, locationId) {
    if (delivery.stagingLocationId === locationId)
        return true;
    const extra = delivery.additionalStagingLocationIds;
    return Array.isArray(extra) && extra.includes(locationId);
}
function plannedIds(delivery) {
    const raw = delivery.plannedStagingLocationIds;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((id) => typeof id === "string" && id.length > 0);
}
function hasReleaseEntry(delivery, locationId) {
    const releases = delivery.plannedLocationReleases;
    if (!Array.isArray(releases))
        return false;
    return releases.some((entry) => entry &&
        typeof entry === "object" &&
        entry.locationId === locationId);
}
exports.releasePlannedStagingLocation = (0, https_1.onCall)({
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
    const locationId = asStagingLocationId(data.locationId);
    const placed = asPlacedFlag(data.placed);
    if (!deliveryId || !sessionToken || !locationId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid request.");
    }
    await (0, vendorSessionValidation_1.assertVendorSessionValid)(sessionToken, deliveryId);
    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    let response = null;
    await db.runTransaction(async (tx) => {
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const delivery = deliverySnap.data();
        const status = String(delivery.status ?? "");
        if (status === "picked_up" || status === "installed") {
            throw new https_1.HttpsError("failed-precondition", "Delivery is no longer active.");
        }
        const planned = plannedIds(delivery);
        if (!planned.includes(locationId)) {
            throw new https_1.HttpsError("failed-precondition", "Location is not a planned spot for this delivery.");
        }
        if (hasReleaseEntry(delivery, locationId)) {
            response = { deliveryId, locationId, placed, skipped: true };
            return;
        }
        const actualIds = (0, deliveryDetailsResponse_1.getAllStagingLocationIds)(delivery);
        if (actualIds.includes(locationId)) {
            response = { deliveryId, locationId, placed: true, skipped: true };
            return;
        }
        const now = new Date().toISOString();
        if (placed) {
            if (!deliveryUsesStagingLocation(delivery, locationId)) {
                await (0, stagingOccupancyGuard_1.assertStagingLocationAvailableInTransaction)(tx, db, locationId, deliveryId);
            }
            if (!delivery.stagingLocationId || delivery.stagingLocationId === "") {
                tx.update(deliveryRef, {
                    stagingLocationId: locationId,
                    updatedAt: now,
                });
            }
            else if (!actualIds.includes(locationId)) {
                tx.update(deliveryRef, {
                    additionalStagingLocationIds: firestore_1.FieldValue.arrayUnion(locationId),
                    updatedAt: now,
                });
            }
            response = { deliveryId, locationId, placed: true };
            return;
        }
        const releaseEntry = {
            locationId,
            releasedAt: now,
            releasedBy: "vendor",
            reason: "vendor_declined_planned_spot",
        };
        tx.update(deliveryRef, {
            plannedStagingLocationIds: firestore_1.FieldValue.arrayRemove(locationId),
            plannedLocationReleases: firestore_1.FieldValue.arrayUnion(releaseEntry),
            updatedAt: now,
        });
        response = { deliveryId, locationId, placed: false, released: true };
    });
    if (!response) {
        throw new https_1.HttpsError("internal", "Release planned staging did not complete.");
    }
    return response;
});
//# sourceMappingURL=releasePlannedStagingLocation.js.map