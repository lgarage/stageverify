"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyInvoiceReviewFieldCorrection = void 0;
/**
 * Lane C C2 — applyInvoiceReviewFieldCorrection callable.
 * Mutates only vendorInvoiceImports.parsedHeader.<allowlisted field> + audit.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const applyInvoiceReviewFieldCorrection_1 = require("./invoice/reviewChat/applyInvoiceReviewFieldCorrection");
function getDb() {
    return admin.firestore();
}
function mapApplyError(err) {
    if (err.code === "not-found") {
        return new https_1.HttpsError("not-found", err.message);
    }
    if (err.code === "permission-denied") {
        return new https_1.HttpsError("permission-denied", err.message);
    }
    if (err.code === "failed-precondition") {
        const friendly = {
            expected_current_value_stale: "The parsed value changed since this correction was proposed. Ask the agent to re-check, then apply again.",
            not_independently_verifiable: "I can't apply that value — it isn't in the invoice text and you haven't typed it exactly. Type the exact value in chat, then apply.",
            import_not_pending_review: "Corrections can only be applied while the invoice is still pending review.",
            field_not_allowed: "That field cannot be corrected via chat.",
            correction_no_longer_current: "This correction proposal is no longer current.",
        };
        return new https_1.HttpsError("failed-precondition", friendly[err.message] ?? err.message);
    }
    return new https_1.HttpsError("invalid-argument", err.message);
}
exports.applyInvoiceReviewFieldCorrection = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const vendorInvoiceImportId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const sourceMessageId = typeof data.sourceMessageId === "string"
        ? data.sourceMessageId.trim()
        : "";
    const idempotencyKey = typeof data.idempotencyKey === "string"
        ? data.idempotencyKey.trim()
        : "";
    const triggerModeRaw = typeof data.triggerMode === "string" ? data.triggerMode.trim() : "";
    const triggerMode = triggerModeRaw === "apply_button" ||
        triggerModeRaw === "chat_direct_command" ||
        triggerModeRaw === "chat_confirmation"
        ? triggerModeRaw
        : undefined;
    if (!vendorInvoiceImportId || !sourceMessageId || !idempotencyKey) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId, sourceMessageId, and idempotencyKey are required.");
    }
    try {
        return await (0, applyInvoiceReviewFieldCorrection_1.runApplyInvoiceReviewFieldCorrectionCore)({
            db: getDb(),
            uid,
            vendorInvoiceImportId,
            sourceMessageId,
            idempotencyKey,
            triggerMode,
        });
    }
    catch (err) {
        if (err instanceof applyInvoiceReviewFieldCorrection_1.ApplyCorrectionInputError) {
            throw mapApplyError(err);
        }
        console.error("applyInvoiceReviewFieldCorrection failed:", err);
        throw new https_1.HttpsError("internal", "Could not apply the correction right now.");
    }
});
//# sourceMappingURL=applyInvoiceReviewFieldCorrectionApi.js.map