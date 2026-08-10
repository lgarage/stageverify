"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassignDeliveryStagingLocation = void 0;
/**
 * Dispatcher Change Location — atomic reassignment of active shop staging.
 * Releases ALL prior planned/actual staging refs and sets a single new primary.
 * Does NOT change multi-spot Assign Location merge semantics (client planned merge).
 */
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const invoiceShellDisplayHelpers_1 = require("./invoice/invoiceShellDisplayHelpers");
const stagingOccupancyGuard_1 = require("./stagingOccupancyGuard");
function getDb() {
    return admin.firestore();
}
const MAX_STAGING_ID_LEN = 128;
const MAX_NOTE_LEN = 500;
function asDeliveryId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128)
        return null;
    return trimmed;
}
function asStagingLocationId(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_STAGING_ID_LEN)
        return null;
    return trimmed;
}
function asOptionalNote(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value !== "string") {
        throw new https_1.HttpsError("invalid-argument", "Invalid note.");
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_NOTE_LEN) {
        throw new https_1.HttpsError("invalid-argument", "Note is too long.");
    }
    return trimmed || undefined;
}
function filterNonEmptyStrings(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value) {
        if (typeof entry !== "string")
            continue;
        const trimmed = entry.trim();
        if (trimmed)
            out.push(trimmed);
    }
    return out;
}
function dedupe(ids) {
    return [...new Set(ids)];
}
function hasAnyStagingRefs(delivery) {
    const primary = typeof delivery.stagingLocationId === "string"
        ? delivery.stagingLocationId.trim()
        : "";
    if (primary)
        return true;
    if (filterNonEmptyStrings(delivery.additionalStagingLocationIds).length > 0) {
        return true;
    }
    return filterNonEmptyStrings(delivery.plannedStagingLocationIds).length > 0;
}
function dispatcherIdentity(request, uid) {
    const email = request.auth?.token?.email?.trim();
    if (email)
        return email;
    const name = request.auth?.token?.name?.trim();
    if (name)
        return name;
    return uid;
}
exports.reassignDeliveryStagingLocation = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const deliveryId = asDeliveryId(data.deliveryId);
    const newLocationId = asStagingLocationId(data.newLocationId);
    const note = asOptionalNote(data.note);
    if (!deliveryId) {
        throw new https_1.HttpsError("invalid-argument", "deliveryId is required.");
    }
    if (!newLocationId) {
        throw new https_1.HttpsError("invalid-argument", "newLocationId is required.");
    }
    const db = getDb();
    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const releasedBy = dispatcherIdentity(request, uid);
    let result = null;
    await db.runTransaction(async (tx) => {
        const deliverySnap = await tx.get(deliveryRef);
        if (!deliverySnap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const delivery = deliverySnap.data();
        const status = String(delivery.status ?? "");
        if (status === "picked_up" || status === "installed") {
            throw new https_1.HttpsError("failed-precondition", "Delivery is no longer editable for staging.");
        }
        if ((0, invoiceShellDisplayHelpers_1.skipsShopStaging)({
            id: deliveryId,
            vendorInvoiceImportId: typeof delivery.vendorInvoiceImportId === "string"
                ? delivery.vendorInvoiceImportId
                : undefined,
            invoiceImportStatus: typeof delivery.invoiceImportStatus === "string"
                ? delivery.invoiceImportStatus
                : undefined,
            invoiceFulfillmentMethod: delivery.invoiceFulfillmentMethod,
            invoiceDeliverToSite: delivery.invoiceDeliverToSite === true,
            createdFromInvoiceImport: delivery.createdFromInvoiceImport === true,
        })) {
            throw new https_1.HttpsError("failed-precondition", "Will-Call / Pickup from Vendor has no shop staging to change.");
        }
        if (!hasAnyStagingRefs(delivery)) {
            throw new https_1.HttpsError("failed-precondition", "No staging assignment to change — use Assign Location.");
        }
        const oldPrimary = typeof delivery.stagingLocationId === "string"
            ? delivery.stagingLocationId.trim()
            : "";
        const oldAdditional = filterNonEmptyStrings(delivery.additionalStagingLocationIds);
        const oldPlanned = filterNonEmptyStrings(delivery.plannedStagingLocationIds);
        const oldActiveIds = dedupe([oldPrimary, ...oldAdditional].filter(Boolean));
        const alreadyTarget = oldPrimary === newLocationId &&
            oldAdditional.length === 0 &&
            oldPlanned.length === 0;
        if (alreadyTarget) {
            const locSnap = await tx.get(db.collection("stagingLocations").doc(newLocationId));
            const toLocationCode = locSnap.exists
                ? String(locSnap.data()?.code ?? "").trim() || newLocationId
                : newLocationId;
            result = {
                ok: true,
                unchanged: true,
                deliveryId,
                fromLocationId: oldPrimary || null,
                releasedLocationIds: [],
                toLocationId: newLocationId,
                toLocationCode,
                plannedEntriesReleased: [],
            };
            return;
        }
        const { code: toLocationCode } = await (0, stagingOccupancyGuard_1.assertStagingLocationAvailableInTransaction)(tx, db, newLocationId, deliveryId);
        const now = new Date().toISOString();
        const releasedAuditIds = oldPlanned.filter((id) => id !== newLocationId);
        const patch = {
            stagingLocationId: newLocationId,
            additionalStagingLocationIds: [],
            plannedStagingLocationIds: [],
            updatedAt: now,
        };
        if (releasedAuditIds.length > 0) {
            patch.plannedLocationReleases = firestore_1.FieldValue.arrayUnion(...releasedAuditIds.map((id) => ({
                locationId: id,
                releasedAt: now,
                releasedBy,
                reason: "dispatcher_change_location",
                ...(note ? { note } : {}),
            })));
        }
        tx.update(deliveryRef, patch);
        result = {
            ok: true,
            deliveryId,
            fromLocationId: oldPrimary || null,
            releasedLocationIds: oldActiveIds,
            toLocationId: newLocationId,
            toLocationCode,
            plannedEntriesReleased: oldPlanned,
        };
    });
    if (!result) {
        throw new https_1.HttpsError("internal", "Reassignment did not complete.");
    }
    return result;
});
//# sourceMappingURL=reassignDeliveryStagingLocation.js.map