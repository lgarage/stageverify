import { deriveImportStatus, scoreInvoiceConfidence } from "./inferImportStatus";
import { mergeParsedInvoices, specializedParseSucceeded } from "./mergeParsedInvoices";
import {
  pageTextFingerprint as canonicalFingerprint,
  detectVendorNameFromText,
  parseCanonicalInvoicePage,
} from "./parseCanonicalInvoice";
import { pageTextFingerprint as johnstoneFingerprint, parseJohnstoneInvoicePage } from "./parseJohnstoneInvoice";
import {
  pageTextFingerprint as firstSupplyFingerprint,
  parseFirstSupplyInvoicePage,
} from "./parseFirstSupplyInvoice";
import { routeInvoiceFormat, vendorDisplayNameForFormat } from "./vendorInvoiceRouter";
import type {
  InvoiceProcessOptions,
  InvoiceProcessingResult,
  JohnstoneInvoicePageText,
  ParsedJohnstoneInvoice,
  VendorInvoiceParserFormatId,
} from "./types";
import { INVOICE_AUTO_APPLY_CONFIDENCE } from "./types";

export interface ExistingInvoiceIndex {
  byPageId: Map<string, string>;
  byFingerprint: Map<string, string>;
}

function fingerprintForFormat(
  formatId: VendorInvoiceParserFormatId,
  page: JohnstoneInvoicePageText,
): string {
  if (formatId === "first_supply") return firstSupplyFingerprint(page);
  if (formatId === "johnstone") return johnstoneFingerprint(page);
  return canonicalFingerprint(page);
}

function resolveEffectiveFormat(
  routeFormatId: VendorInvoiceParserFormatId,
  canonical: ParsedJohnstoneInvoice,
): VendorInvoiceParserFormatId {
  if (routeFormatId === "johnstone" || routeFormatId === "first_supply") {
    return routeFormatId;
  }
  const hasInvoice = Boolean(canonical.header.vendorInvoiceNumber);
  const hasLines = canonical.lines.some((l) => l.lineType === "product");
  if (hasInvoice || hasLines) return "generic";
  return "unknown";
}

function buildParsedInvoice(
  page: JohnstoneInvoicePageText,
  routeFormatId: VendorInvoiceParserFormatId,
): { parsed: ParsedJohnstoneInvoice; formatId: VendorInvoiceParserFormatId } {
  const canonical = parseCanonicalInvoicePage(page);

  if (routeFormatId === "first_supply") {
    const merged = mergeParsedInvoices(canonical, parseFirstSupplyInvoicePage(page));
    if (specializedParseSucceeded(merged, "first_supply")) {
      return { parsed: merged, formatId: "first_supply" };
    }
    return {
      parsed: canonical,
      formatId: resolveEffectiveFormat("unknown", canonical),
    };
  }
  if (routeFormatId === "johnstone") {
    const merged = mergeParsedInvoices(canonical, parseJohnstoneInvoicePage(page));
    if (specializedParseSucceeded(merged, "johnstone")) {
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

export function processInvoicePage(
  page: JohnstoneInvoicePageText,
  existing: ExistingInvoiceIndex,
  options?: InvoiceProcessOptions,
): InvoiceProcessingResult {
  const route = routeInvoiceFormat(page.extractedText, options?.routeHints);
  const { parsed, formatId } = buildParsedInvoice(page, route.formatId);

  const fingerprint = fingerprintForFormat(formatId, page);
  const importStatus = deriveImportStatus(parsed, formatId);
  const confidence = scoreInvoiceConfidence(parsed, formatId);

  const duplicateOfPage = existing.byPageId.get(page.pageId);
  const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
  const duplicate = Boolean(duplicateOfPage || duplicateOfFingerprint);

  let reviewStatus: InvoiceProcessingResult["reviewStatus"] = "pending_review";
  if (duplicate) {
    reviewStatus = "rejected";
  } else if (importStatus === "issue" || formatId === "unknown") {
    reviewStatus = "pending_review";
  } else if (
    confidence.tier === "high" &&
    !confidence.humanReviewRequired &&
    confidence.score >= INVOICE_AUTO_APPLY_CONFIDENCE &&
    importStatus !== "partial" &&
    formatId !== "generic"
  ) {
    reviewStatus = "auto_processed";
  } else if (confidence.humanReviewRequired || formatId === "generic") {
    reviewStatus = "pending_review";
  }

  const detectedVendorName =
    formatId === "johnstone" || formatId === "first_supply"
      ? vendorDisplayNameForFormat(formatId)
      : detectVendorNameFromText(page.extractedText);

  return {
    page,
    parsed,
    importStatus,
    confidenceTier: confidence.tier,
    confidenceScore: confidence.score,
    humanReviewRequired:
      formatId === "unknown" || formatId === "generic" ? true : confidence.humanReviewRequired,
    duplicate,
    duplicateOfPageId: duplicateOfPage ?? duplicateOfFingerprint,
    reviewStatus,
    parserFormatId: formatId,
    parserRouteConfidence: route.confidence,
    detectedVendorName,
  };
}

/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
export function expectedInvoiceLines(result: InvoiceProcessingResult) {
  return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
