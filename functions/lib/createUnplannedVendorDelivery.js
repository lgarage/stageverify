"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUnplannedVendorDelivery = void 0;
/**
 * Create a controlled unplanned / needs-review delivery shell (no safe match).
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const unplannedVendorDeliveryMatching_1 = require("./unplannedVendorDeliveryMatching");
const unplannedVendorDeliveryShared_1 = require("./unplannedVendorDeliveryShared");
function getDb() {
    return admin.firestore();
}
exports.createUnplannedVendorDelivery = (0, https_1.onCall)({
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
    const spaceTier = (0, unplannedVendorDeliveryShared_1.asSpaceTier)(data.spaceTier);
    const packageCount = (0, unplannedVendorDeliveryShared_1.asOptionalPackageCount)(data.packageCount);
    if (!sessionToken || !reference) {
        throw new https_1.HttpsError("invalid-argument", "Reference is required.");
    }
    if (!spaceTier) {
        throw new https_1.HttpsError("invalid-argument", "Choose Shelf, Ground, or Large / Oversize.");
    }
    const session = await (0, vendorSessionValidation_1.assertVendorUnplannedSessionValid)(sessionToken);
    // Race-close: if a strong match now exists, do not create a shell.
    const classification = await (0, unplannedVendorDeliveryShared_1.runVendorScopedUnplannedMatch)(session.vendorId, reference);
    if (classification.outcome === "strong_match" && classification.candidate) {
        return {
            success: false,
            outcome: "strong_match_found",
            candidate: {
                deliveryId: classification.candidate.deliveryId,
                orderNumber: classification.candidate.orderNumber,
                jobName: classification.candidate.jobName,
                poNumber: classification.candidate.poNumber,
                confidenceScore: classification.candidate.confidenceScore,
            },
        };
    }
    const deliveryId = (0, unplannedVendorDeliveryMatching_1.unplannedDeliveryDocId)(session.vendorId, reference);
    const deliveryRef = getDb().collection("deliveries").doc(deliveryId);
    const existing = await deliveryRef.get();
    const now = new Date().toISOString();
    if (existing.exists) {
        const existingVendorId = String(existing.data()?.vendorId ?? "");
        if (existingVendorId !== session.vendorId) {
            throw new https_1.HttpsError("permission-denied", "Delivery reference conflict. Ask dispatch for help.");
        }
    }
    if (!existing.exists) {
        const matchStatus = classification.outcome === "ambiguous" ? "ambiguous" : "no_match";
        const orderNumber = `UNPL-${now.slice(0, 10).replace(/-/g, "")}-${deliveryId.slice(-6)}`;
        const shell = {
            id: deliveryId,
            orderNumber,
            vendorId: session.vendorId,
            vendorName: session.vendorName,
            vendorInvoiceNumber: reference.trim(),
            deliveryDate: now.slice(0, 10),
            status: "pending",
            availabilityStatus: "expected",
            invoiceFulfillmentMethod: "delivery",
            unplanned: true,
            unplannedSubmittedReference: reference.trim(),
            unplannedMatchStatus: matchStatus,
            unplannedCreatedVia: "vendor_pin_fallback",
            unplannedSpaceTierRequested: spaceTier,
            ...(packageCount != null ? { unplannedPackageCount: packageCount } : {}),
            ...(classification.outcome === "ambiguous"
                ? {
                    unplannedAmbiguousCandidateSummaries: classification.candidateSummaries.slice(0, 3).map((c) => ({
                        deliveryId: c.deliveryId,
                        orderNumber: c.orderNumber,
                        confidenceScore: c.confidenceScore,
                    })),
                }
                : {}),
            reviewFlag: {
                flagged: true,
                reason: "Unplanned delivery received — needs job/PO match",
                flaggedBy: "vendor",
                flaggedAt: now,
            },
            ...(session.scannedStagingLocationId
                ? {
                    scannedStagingLocationId: session.scannedStagingLocationId,
                    scannedStagingLocationCode: session.scannedStagingLocationCode,
                }
                : {}),
            createdAt: now,
            updatedAt: now,
        };
        try {
            await deliveryRef.create(shell);
            await (0, unplannedVendorDeliveryShared_1.writeUnplannedAudit)({
                action: "VENDOR_UNPLANNED_DELIVERY_CREATED",
                vendorId: session.vendorId,
                vendorName: session.vendorName,
                deliveryId,
                reference,
                details: { matchStatus, spaceTier },
            });
        }
        catch (err) {
            const code = err && typeof err === "object" && "code" in err
                ? Number(err.code)
                : 0;
            // ALREADY_EXISTS → idempotent replay
            if (code !== 6)
                throw err;
        }
    }
    let needMoreSpace = false;
    let assignedCode;
    const fresh = await deliveryRef.get();
    const current = fresh.data() ?? {};
    if (!String(current.stagingLocationId ?? "").trim()) {
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
    else if (typeof current.stagingLocationId === "string") {
        const locSnap = await getDb()
            .collection("stagingLocations")
            .doc(current.stagingLocationId)
            .get();
        assignedCode =
            typeof locSnap.data()?.code === "string"
                ? locSnap.data().code
                : current.stagingLocationId;
    }
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
//# sourceMappingURL=createUnplannedVendorDelivery.js.map