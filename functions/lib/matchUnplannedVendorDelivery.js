"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchUnplannedVendorDelivery = void 0;
/**
 * Read-only match preview for vendor unplanned-delivery fallback.
 */
const https_1 = require("firebase-functions/v2/https");
const vendorSessionValidation_1 = require("./vendorSessionValidation");
const unplannedVendorDeliveryMatching_1 = require("./unplannedVendorDeliveryMatching");
const unplannedVendorDeliveryShared_1 = require("./unplannedVendorDeliveryShared");
exports.matchUnplannedVendorDelivery = (0, https_1.onCall)({
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
    if (!sessionToken || !reference) {
        throw new https_1.HttpsError("invalid-argument", "Reference is required.");
    }
    const session = await (0, vendorSessionValidation_1.assertVendorUnplannedSessionValid)(sessionToken);
    await (0, unplannedVendorDeliveryShared_1.checkUnplannedPreviewRateLimit)(sessionToken);
    const classification = await (0, unplannedVendorDeliveryShared_1.runVendorScopedUnplannedMatch)(session.vendorId, reference);
    await (0, unplannedVendorDeliveryShared_1.writeUnplannedAudit)({
        action: classification.outcome === "strong_match"
            ? "VENDOR_UNPLANNED_MATCH_FOUND"
            : classification.outcome === "ambiguous"
                ? "VENDOR_UNPLANNED_MATCH_AMBIGUOUS"
                : "VENDOR_UNPLANNED_MATCH_NOT_FOUND",
        vendorId: session.vendorId,
        vendorName: session.vendorName,
        reference,
        details: {
            outcome: classification.outcome,
            candidateCount: classification.candidateSummaries.length,
        },
    });
    if (classification.outcome === "strong_match" && classification.candidate) {
        return {
            outcome: "strong_match",
            candidate: (0, unplannedVendorDeliveryShared_1.publicCandidate)(classification.candidate),
        };
    }
    if (classification.outcome === "ambiguous") {
        return {
            outcome: "ambiguous",
            candidateSummaries: classification.candidateSummaries.map(unplannedVendorDeliveryShared_1.publicCandidate),
        };
    }
    return { outcome: "no_match" };
});
//# sourceMappingURL=matchUnplannedVendorDelivery.js.map