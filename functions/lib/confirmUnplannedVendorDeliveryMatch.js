"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmUnplannedVendorDeliveryMatch = void 0;
/**
 * Vendor confirms a strong match → stamp existing delivery; no duplicate shell.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const unplannedVendorDeliveryMatching_1 = require("./unplannedVendorDeliveryMatching");
const unplannedVendorDeliveryShared_1 = require("./unplannedVendorDeliveryShared");
function getDb() {
    return admin.firestore();
}
exports.confirmUnplannedVendorDeliveryMatch = (0, https_1.onCall)({
    region: "us-central1",
    cors: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://lgarage.github.io",
    ],
}, async (request) => {
    const data = (request.data ?? {});
    const sessionToken = (0, vendorSessionValidation_1.asSessionToken)(data.sessionToken);
    const reference = (0, unplannedVendorDeliveryMatching_1.asUnplannedReference)(data.reference);
    const clientDeliveryId = (0, vendorSessionValidation_1.asDeliveryId)(data.deliveryId);
    const spaceTier = (0, unplannedVendorDeliveryShared_1.asSpaceTier)(data.spaceTier);
    const packageCount = (0, unplannedVendorDeliveryShared_1.asOptionalPackageCount)(data.packageCount);
    if (!sessionToken || !reference || !clientDeliveryId) {
        throw new https_1.HttpsError("invalid-argument", "Invalid confirm request.");
    }
    const session = await (0, vendorSessionValidation_1.assertVendorUnplannedSessionValid)(sessionToken);
    // Re-run match server-side — never trust client-picked deliveryId alone.
    const classification = await (0, unplannedVendorDeliveryShared_1.runVendorScopedUnplannedMatch)(session.vendorId, reference);
    if (classification.outcome !== "strong_match" ||
        !classification.candidate ||
        classification.candidate.deliveryId !== clientDeliveryId) {
        throw new https_1.HttpsError("failed-precondition", "Match is no longer valid. Search again.");
    }
    const deliveryId = classification.candidate.deliveryId;
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(deliveryRef);
        if (!snap.exists) {
            throw new https_1.HttpsError("not-found", "Delivery not found.");
        }
        const delivery = snap.data();
        if (String(delivery.vendorId ?? "") !== session.vendorId) {
            throw new https_1.HttpsError("permission-denied", "Session is not valid for this delivery.");
        }
        const now = new Date().toISOString();
        const patch = {
            vendorUnplannedConfirmedAt: now,
            vendorUnplannedConfirmedVia: "vendor_pin_fallback",
            unplannedSubmittedReference: reference.trim(),
            updatedAt: now,
        };
        if (packageCount != null) {
            patch.unplannedPackageCount = packageCount;
        }
        if (session.scannedStagingLocationId &&
            !String(delivery.stagingLocationId ?? "").trim()) {
            patch.scannedStagingLocationId = session.scannedStagingLocationId;
            if (session.scannedStagingLocationCode) {
                patch.scannedStagingLocationCode = session.scannedStagingLocationCode;
            }
        }
        tx.update(deliveryRef, patch);
    });
    let needMoreSpace = false;
    let assignedCode;
    if (spaceTier) {
        const picked = await (0, unplannedVendorDeliveryShared_1.pickAvailableStagingForTier)(spaceTier, deliveryId);
        if (picked) {
            await deliveryRef.update({
                stagingLocationId: picked.id,
                updatedAt: new Date().toISOString(),
            });
            assignedCode = picked.code;
            await (0, unplannedVendorDeliveryShared_1.writeUnplannedAudit)({
                action: "VENDOR_UNPLANNED_STAGING_ASSIGNED",
                vendorId: session.vendorId,
                vendorName: session.vendorName,
                deliveryId,
                reference,
                details: { spaceTier, stagingLocationId: picked.id, code: picked.code },
            });
        }
        else {
            needMoreSpace = true;
            await deliveryRef.update({
                unplannedNeedMoreSpace: true,
                unplannedSpaceTierRequested: spaceTier,
                updatedAt: new Date().toISOString(),
            });
            await (0, unplannedVendorDeliveryShared_1.writeUnplannedAudit)({
                action: "VENDOR_UNPLANNED_NEED_MORE_SPACE",
                vendorId: session.vendorId,
                vendorName: session.vendorName,
                deliveryId,
                reference,
                details: { spaceTier },
            });
        }
    }
    await (0, unplannedVendorDeliveryShared_1.writeUnplannedAudit)({
        action: "VENDOR_UNPLANNED_MATCH_CONFIRMED",
        vendorId: session.vendorId,
        vendorName: session.vendorName,
        deliveryId,
        reference,
    });
    const payload = await (0, unplannedVendorDeliveryShared_1.buildUnplannedSuccessPayload)({
        deliveryId,
        vendorId: session.vendorId,
        vendorName: session.vendorName,
        session,
    });
    return {
        ...payload,
        needMoreSpace,
        ...(assignedCode ? { stagingLocationCode: assignedCode } : {}),
    };
});
//# sourceMappingURL=confirmUnplannedVendorDeliveryMatch.js.map