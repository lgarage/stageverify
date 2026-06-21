"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInboundEmail = processInboundEmail;
exports.buildVendorOrderCompletePatch = buildVendorOrderCompletePatch;
const matchEmailToRecords_1 = require("./matchEmailToRecords");
const parseVendorEmail_1 = require("./parseVendorEmail");
const types_1 = require("./types");
function processInboundEmail(message, ctx, existing) {
    const parsed = (0, parseVendorEmail_1.parseVendorEmail)(message);
    const fingerprint = (0, parseVendorEmail_1.contentFingerprint)(message);
    const match = (0, matchEmailToRecords_1.matchEmailToRecords)(message, parsed, ctx);
    const duplicateOfMessage = existing.byMessageId.get(message.sourceMessageId);
    const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
    const duplicate = Boolean(duplicateOfMessage || duplicateOfFingerprint);
    let reviewStatus = "pending_review";
    if (duplicate) {
        reviewStatus = "rejected";
    }
    else if (parsed.classification === "irrelevant") {
        reviewStatus = "rejected";
    }
    else if ((0, matchEmailToRecords_1.shouldAutoApplyVendorOrderComplete)(parsed, match) &&
        match.confidenceScore >= types_1.EMAIL_AUTO_APPLY_CONFIDENCE) {
        reviewStatus = "auto_processed";
    }
    else if (match.humanReviewRequired) {
        reviewStatus = "pending_review";
    }
    return {
        message,
        parsed,
        match,
        duplicate,
        duplicateOfEventId: duplicateOfMessage ?? duplicateOfFingerprint,
        reviewStatus,
    };
}
/** Condition 1 evidence only — readiness recalculation is a separate server step. */
function buildVendorOrderCompletePatch(now) {
    return {
        vendorOrderComplete: true,
        vendorOrderCompleteAt: now,
        vendorOrderCompleteSource: "vendor_email",
        updatedAt: now,
    };
}
//# sourceMappingURL=processEmailMessage.js.map