"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZONE_CLEARED = exports.OCCUPANCY_PAGE_SIZE = void 0;
exports.isLocationDocActive = isLocationDocActive;
exports.deliveryOccupiesDestination = deliveryOccupiesDestination;
exports.throwOccupied = throwOccupied;
exports.assertNoActiveOccupantInQuery = assertNoActiveOccupantInQuery;
exports.assertStagingLocationAvailableInTransaction = assertStagingLocationAvailableInTransaction;
const https_1 = require("firebase-functions/v2/https");
/** Page size for occupancy scans — keep paging while a page is full. */
exports.OCCUPANCY_PAGE_SIZE = 20;
exports.ZONE_CLEARED = new Set(["complete", "picked_up", "installed"]);
function isLocationDocActive(data) {
    if (typeof data.status === "string") {
        return data.status === "Active";
    }
    return data.active === true;
}
function deliveryOccupiesDestination(data) {
    if (!data)
        return false;
    if (exports.ZONE_CLEARED.has(String(data.status ?? "")))
        return false;
    return true;
}
function throwOccupied() {
    throw new https_1.HttpsError("failed-precondition", "That location is no longer available.");
}
async function assertNoActiveOccupantInQuery(tx, baseQuery, deliveryId) {
    // Firestore transactions require all reads before writes; page with cursors
    // so cleared/stale docs cannot hide an active occupant behind a small limit.
    let last;
    for (;;) {
        let q = baseQuery.limit(exports.OCCUPANCY_PAGE_SIZE);
        if (last)
            q = q.startAfter(last);
        const snap = await tx.get(q);
        if (snap.empty)
            return;
        for (const docSnap of snap.docs) {
            if (docSnap.id === deliveryId)
                continue;
            if (deliveryOccupiesDestination(docSnap.data())) {
                throwOccupied();
            }
        }
        if (snap.size < exports.OCCUPANCY_PAGE_SIZE)
            return;
        last = snap.docs[snap.docs.length - 1];
    }
}
async function assertStagingLocationAvailableInTransaction(tx, db, locationId, excludeDeliveryId) {
    const locRef = db.collection("stagingLocations").doc(locationId);
    const locSnap = await tx.get(locRef);
    if (!locSnap.exists) {
        throw new https_1.HttpsError("not-found", "Staging location not found.");
    }
    const locData = locSnap.data();
    if (!isLocationDocActive(locData)) {
        throw new https_1.HttpsError("failed-precondition", "That location is no longer available.");
    }
    const code = String(locData.code ?? "").trim() || locationId;
    await assertNoActiveOccupantInQuery(tx, db.collection("deliveries").where("stagingLocationId", "==", locationId), excludeDeliveryId);
    await assertNoActiveOccupantInQuery(tx, db
        .collection("deliveries")
        .where("additionalStagingLocationIds", "array-contains", locationId), excludeDeliveryId);
    await assertNoActiveOccupantInQuery(tx, db
        .collection("deliveries")
        .where("plannedStagingLocationIds", "array-contains", locationId), excludeDeliveryId);
    return { code };
}
//# sourceMappingURL=stagingOccupancyGuard.js.map