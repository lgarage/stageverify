"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInvoicePage = processInvoicePage;
exports.expectedInvoiceLines = expectedInvoiceLines;
const inferImportStatus_1 = require("./inferImportStatus");
const parseJohnstoneInvoice_1 = require("./parseJohnstoneInvoice");
const types_1 = require("./types");
function processInvoicePage(page, existing) {
    const parsed = (0, parseJohnstoneInvoice_1.parseJohnstoneInvoicePage)(page);
    const fingerprint = (0, parseJohnstoneInvoice_1.pageTextFingerprint)(page);
    const importStatus = (0, inferImportStatus_1.deriveImportStatus)(parsed);
    const confidence = (0, inferImportStatus_1.scoreInvoiceConfidence)(parsed);
    const duplicateOfPage = existing.byPageId.get(page.pageId);
    const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
    const duplicate = Boolean(duplicateOfPage || duplicateOfFingerprint);
    let reviewStatus = "pending_review";
    if (duplicate) {
        reviewStatus = "rejected";
    }
    else if (importStatus === "issue") {
        reviewStatus = "pending_review";
    }
    else if (confidence.tier === "high" &&
        !confidence.humanReviewRequired &&
        confidence.score >= types_1.INVOICE_AUTO_APPLY_CONFIDENCE &&
        importStatus !== "partial") {
        reviewStatus = "auto_processed";
    }
    else if (confidence.humanReviewRequired) {
        reviewStatus = "pending_review";
    }
    return {
        page,
        parsed,
        importStatus,
        confidenceTier: confidence.tier,
        confidenceScore: confidence.score,
        humanReviewRequired: confidence.humanReviewRequired,
        duplicate,
        duplicateOfPageId: duplicateOfPage ?? duplicateOfFingerprint,
        reviewStatus,
    };
}
/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
function expectedInvoiceLines(result) {
    return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
//# sourceMappingURL=processInvoicePage.js.map