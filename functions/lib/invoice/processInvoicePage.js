"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInvoicePage = processInvoicePage;
exports.expectedInvoiceLines = expectedInvoiceLines;
const inferImportStatus_1 = require("./inferImportStatus");
const parseJohnstoneInvoice_1 = require("./parseJohnstoneInvoice");
const parseFirstSupplyInvoice_1 = require("./parseFirstSupplyInvoice");
const vendorInvoiceRouter_1 = require("./vendorInvoiceRouter");
const types_1 = require("./types");
function fingerprintForFormat(formatId, page) {
    if (formatId === "first_supply")
        return (0, parseFirstSupplyInvoice_1.pageTextFingerprint)(page);
    return (0, parseJohnstoneInvoice_1.pageTextFingerprint)(page);
}
function buildUnknownFormatParsed(_page) {
    return {
        header: {
            customerAccountNumber: "",
            vendorOrderNumber: "",
            vendorInvoiceNumber: "",
            customerPoOrReference: "",
            orderDate: "",
            invoiceDate: "",
            shipDate: "",
            vendorBranchName: "",
            vendorBranchAddress: "",
            vendorBranchPhone: "",
            soldToName: "",
            shipToName: "",
            shipToAddress: "",
            fulfillmentMethod: "unknown",
            shipCompletePolicy: "unknown",
        },
        lines: [],
        orderNotes: [],
        parseWarnings: ["Unrecognized vendor invoice format"],
    };
}
function processInvoicePage(page, existing, options) {
    const route = (0, vendorInvoiceRouter_1.routeInvoiceFormat)(page.extractedText, options?.routeHints);
    const formatId = route.formatId;
    const parsed = formatId === "first_supply"
        ? (0, parseFirstSupplyInvoice_1.parseFirstSupplyInvoicePage)(page)
        : formatId === "johnstone"
            ? (0, parseJohnstoneInvoice_1.parseJohnstoneInvoicePage)(page)
            : buildUnknownFormatParsed(page);
    const fingerprint = fingerprintForFormat(formatId === "unknown" ? "johnstone" : formatId, page);
    const importStatus = formatId === "unknown" ? "issue" : (0, inferImportStatus_1.deriveImportStatus)(parsed, formatId);
    const confidence = (0, inferImportStatus_1.scoreInvoiceConfidence)(parsed, formatId);
    const duplicateOfPage = existing.byPageId.get(page.pageId);
    const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
    const duplicate = Boolean(duplicateOfPage || duplicateOfFingerprint);
    let reviewStatus = "pending_review";
    if (duplicate) {
        reviewStatus = "rejected";
    }
    else if (importStatus === "issue" || formatId === "unknown") {
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
        humanReviewRequired: formatId === "unknown" ? true : confidence.humanReviewRequired,
        duplicate,
        duplicateOfPageId: duplicateOfPage ?? duplicateOfFingerprint,
        reviewStatus,
        parserFormatId: formatId,
        parserRouteConfidence: route.confidence,
        detectedVendorName: formatId === "unknown" ? undefined : (0, vendorInvoiceRouter_1.vendorDisplayNameForFormat)(formatId),
    };
}
/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
function expectedInvoiceLines(result) {
    return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
//# sourceMappingURL=processInvoicePage.js.map