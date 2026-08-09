"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftStagingLocationsInputError = void 0;
exports.runSetInvoiceReviewDraftStagingLocationsCore = runSetInvoiceReviewDraftStagingLocationsCore;
const sharedStagingIdSanitize_1 = require("./sharedStagingIdSanitize");
const REVIEW_COLLECTION = "vendorInvoiceImports";
class DraftStagingLocationsInputError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DraftStagingLocationsInputError";
        this.code = code;
    }
}
exports.DraftStagingLocationsInputError = DraftStagingLocationsInputError;
function isoNow() {
    return new Date().toISOString();
}
async function runSetInvoiceReviewDraftStagingLocationsCore(input) {
    void input.uid;
    const importId = input.vendorInvoiceImportId.trim();
    if (!importId || importId.length > 256) {
        throw new DraftStagingLocationsInputError("invalid-argument", "Invalid vendorInvoiceImportId.");
    }
    const sanitized = (0, sharedStagingIdSanitize_1.sanitizePlannedStagingLocationIds)(input.stagingLocationIds);
    const importRef = input.db.collection(REVIEW_COLLECTION).doc(importId);
    const importSnap = await importRef.get();
    if (!importSnap.exists) {
        throw new DraftStagingLocationsInputError("not-found", "Invoice import not found.");
    }
    const importDoc = importSnap.data();
    if (importDoc.reviewStatus !== "pending_review") {
        throw new DraftStagingLocationsInputError("failed-precondition", "import_not_pending_review");
    }
    if (sanitized.length > 0) {
        const locSnaps = await Promise.all(sanitized.map((id) => input.db.collection("stagingLocations").doc(id).get()));
        if (locSnaps.some((snap) => !snap.exists)) {
            throw new DraftStagingLocationsInputError("invalid-argument", "One or more selected staging locations no longer exist. Refresh and reselect.");
        }
    }
    const now = isoNow();
    await importRef.update({
        draftPlannedStagingLocationIds: sanitized,
        updatedAt: now,
    });
    return {
        vendorInvoiceImportId: importId,
        draftPlannedStagingLocationIds: sanitized,
        reviewStatus: importDoc.reviewStatus,
    };
}
//# sourceMappingURL=setDraftStagingLocationsCore.js.map