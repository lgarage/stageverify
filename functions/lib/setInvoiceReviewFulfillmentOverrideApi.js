"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setInvoiceReviewFulfillmentOverride = void 0;
/**
 * setInvoiceReviewFulfillmentOverride — Will-Call → Vendor Drop-Off human override.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const setFulfillmentOverrideCore_1 = require("./invoice/fulfillmentOverride/setFulfillmentOverrideCore");
function getDb() {
    return admin.firestore();
}
function mapError(err) {
    if (err.code === "not-found") {
        return new https_1.HttpsError("not-found", err.message);
    }
    if (err.code === "failed-precondition") {
        const friendly = {
            import_not_pending_review: "Fulfillment override can only be applied while the invoice is pending review.",
            fulfillment_override_requires_will_call: "Assign Location override applies only to Will-Call / Pickup @ Vendor imports.",
        };
        return new https_1.HttpsError("failed-precondition", friendly[err.message] ?? err.message);
    }
    return new https_1.HttpsError("invalid-argument", err.message);
}
exports.setInvoiceReviewFulfillmentOverride = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const vendorInvoiceImportId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const toFulfillmentMethod = typeof data.toFulfillmentMethod === "string"
        ? data.toFulfillmentMethod.trim()
        : "";
    const idempotencyKey = typeof data.idempotencyKey === "string" ? data.idempotencyKey.trim() : "";
    if (!vendorInvoiceImportId || !idempotencyKey) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId and idempotencyKey are required.");
    }
    if (toFulfillmentMethod !== "delivery") {
        throw new https_1.HttpsError("invalid-argument", "toFulfillmentMethod must be delivery.");
    }
    try {
        return await (0, setFulfillmentOverrideCore_1.runSetInvoiceReviewFulfillmentOverrideCore)({
            db: getDb(),
            uid,
            vendorInvoiceImportId,
            toFulfillmentMethod: "delivery",
            idempotencyKey,
        });
    }
    catch (err) {
        if (err instanceof setFulfillmentOverrideCore_1.FulfillmentOverrideInputError) {
            throw mapError(err);
        }
        console.error("setInvoiceReviewFulfillmentOverride failed:", err);
        throw new https_1.HttpsError("internal", "Could not apply fulfillment override right now.");
    }
});
//# sourceMappingURL=setInvoiceReviewFulfillmentOverrideApi.js.map