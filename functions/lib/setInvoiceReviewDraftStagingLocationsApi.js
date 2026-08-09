"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setInvoiceReviewDraftStagingLocations = void 0;
/**
 * setInvoiceReviewDraftStagingLocations — persist draft staging picks on pending imports.
 */
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const dispatcherAuth_1 = require("./inboundEmail/dispatcherAuth");
const setDraftStagingLocationsCore_1 = require("./invoice/fulfillmentOverride/setDraftStagingLocationsCore");
function getDb() {
    return admin.firestore();
}
function mapError(err) {
    if (err.code === "not-found") {
        return new https_1.HttpsError("not-found", err.message);
    }
    if (err.code === "failed-precondition") {
        return new https_1.HttpsError("failed-precondition", err.message);
    }
    return new https_1.HttpsError("invalid-argument", err.message);
}
exports.setInvoiceReviewDraftStagingLocations = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    const uid = await (0, dispatcherAuth_1.requireDispatcherAuth)(request);
    const data = (request.data ?? {});
    const vendorInvoiceImportId = typeof data.vendorInvoiceImportId === "string"
        ? data.vendorInvoiceImportId.trim()
        : "";
    const stagingLocationIds = Array.isArray(data.stagingLocationIds)
        ? data.stagingLocationIds
        : data.stagingLocationIds === undefined
            ? []
            : null;
    if (!vendorInvoiceImportId) {
        throw new https_1.HttpsError("invalid-argument", "vendorInvoiceImportId is required.");
    }
    if (stagingLocationIds === null) {
        throw new https_1.HttpsError("invalid-argument", "stagingLocationIds must be an array (use [] to clear).");
    }
    try {
        return await (0, setDraftStagingLocationsCore_1.runSetInvoiceReviewDraftStagingLocationsCore)({
            db: getDb(),
            uid,
            vendorInvoiceImportId,
            stagingLocationIds,
        });
    }
    catch (err) {
        if (err instanceof setDraftStagingLocationsCore_1.DraftStagingLocationsInputError) {
            throw mapError(err);
        }
        console.error("setInvoiceReviewDraftStagingLocations failed:", err);
        throw new https_1.HttpsError("internal", "Could not save draft staging locations right now.");
    }
});
//# sourceMappingURL=setInvoiceReviewDraftStagingLocationsApi.js.map