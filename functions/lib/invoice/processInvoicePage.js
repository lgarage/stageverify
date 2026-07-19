"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processInvoicePage = processInvoicePage;
exports.expectedInvoiceLines = expectedInvoiceLines;
const inferImportStatus_1 = require("./inferImportStatus");
const mergeParsedInvoices_1 = require("./mergeParsedInvoices");
const parseCanonicalInvoice_1 = require("./parseCanonicalInvoice");
const parseJohnstoneInvoice_1 = require("./parseJohnstoneInvoice");
const parseFirstSupplyInvoice_1 = require("./parseFirstSupplyInvoice");
const vendorInvoiceRouter_1 = require("./vendorInvoiceRouter");
const types_1 = require("./types");
function fingerprintForFormat(formatId, page) {
    if (formatId === "first_supply")
        return (0, parseFirstSupplyInvoice_1.pageTextFingerprint)(page);
    if (formatId === "johnstone")
        return (0, parseJohnstoneInvoice_1.pageTextFingerprint)(page);
    return (0, parseCanonicalInvoice_1.pageTextFingerprint)(page);
}
function resolveEffectiveFormat(routeFormatId, canonical) {
    if (routeFormatId === "johnstone" || routeFormatId === "first_supply") {
        return routeFormatId;
    }
    const hasInvoice = Boolean(canonical.header.vendorInvoiceNumber);
    const hasLines = canonical.lines.some((l) => l.lineType === "product");
    if (hasInvoice || hasLines)
        return "generic";
    return "unknown";
}
function buildParsedInvoice(page, routeFormatId) {
    const canonical = (0, parseCanonicalInvoice_1.parseCanonicalInvoicePage)(page);
    if (routeFormatId === "first_supply") {
        const merged = (0, mergeParsedInvoices_1.mergeParsedInvoices)(canonical, (0, parseFirstSupplyInvoice_1.parseFirstSupplyInvoicePage)(page));
        if ((0, mergeParsedInvoices_1.specializedParseSucceeded)(merged, "first_supply")) {
            return { parsed: merged, formatId: "first_supply" };
        }
        return {
            parsed: canonical,
            formatId: resolveEffectiveFormat("unknown", canonical),
        };
    }
    if (routeFormatId === "johnstone") {
        const merged = (0, mergeParsedInvoices_1.mergeParsedInvoices)(canonical, (0, parseJohnstoneInvoice_1.parseJohnstoneInvoicePage)(page));
        if ((0, mergeParsedInvoices_1.specializedParseSucceeded)(merged, "johnstone")) {
            return { parsed: merged, formatId: "johnstone" };
        }
        return {
            parsed: canonical,
            formatId: resolveEffectiveFormat("unknown", canonical),
        };
    }
    const formatId = resolveEffectiveFormat(routeFormatId, canonical);
    return { parsed: canonical, formatId };
}
function processInvoicePage(page, existing, options) {
    const route = (0, vendorInvoiceRouter_1.routeInvoiceFormat)(page.extractedText, options?.routeHints);
    const { parsed, formatId } = buildParsedInvoice(page, route.formatId);
    const fingerprint = fingerprintForFormat(formatId, page);
    const importStatus = (0, inferImportStatus_1.deriveImportStatus)(parsed, formatId);
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
        importStatus !== "partial" &&
        formatId !== "generic") {
        reviewStatus = "auto_processed";
    }
    else if (confidence.humanReviewRequired || formatId === "generic") {
        reviewStatus = "pending_review";
    }
    const detectedVendorName = formatId === "johnstone" || formatId === "first_supply"
        ? (0, vendorInvoiceRouter_1.vendorDisplayNameForFormat)(formatId)
        : (0, parseCanonicalInvoice_1.detectVendorNameFromText)(page.extractedText);
    return {
        page,
        parsed,
        importStatus,
        confidenceTier: confidence.tier,
        confidenceScore: confidence.score,
        humanReviewRequired: formatId === "unknown" || formatId === "generic" ? true : confidence.humanReviewRequired,
        duplicate,
        duplicateOfPageId: duplicateOfPage ?? duplicateOfFingerprint,
        reviewStatus,
        parserFormatId: formatId,
        parserRouteConfidence: route.confidence,
        detectedVendorName,
    };
}
/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
function expectedInvoiceLines(result) {
    return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
//# sourceMappingURL=processInvoicePage.js.map