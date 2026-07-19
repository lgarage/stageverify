import { deriveImportStatus, scoreInvoiceConfidence } from "./inferImportStatus";
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
  return johnstoneFingerprint(page);
}

function buildUnknownFormatParsed(_page: JohnstoneInvoicePageText): ParsedJohnstoneInvoice {
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

export function processInvoicePage(
  page: JohnstoneInvoicePageText,
  existing: ExistingInvoiceIndex,
  options?: InvoiceProcessOptions,
): InvoiceProcessingResult {
  const route = routeInvoiceFormat(page.extractedText, options?.routeHints);
  const formatId = route.formatId;

  const parsed =
    formatId === "first_supply"
      ? parseFirstSupplyInvoicePage(page)
      : formatId === "johnstone"
        ? parseJohnstoneInvoicePage(page)
        : buildUnknownFormatParsed(page);

  const fingerprint = fingerprintForFormat(
    formatId === "unknown" ? "johnstone" : formatId,
    page,
  );
  const importStatus =
    formatId === "unknown" ? "issue" : deriveImportStatus(parsed, formatId);
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
    importStatus !== "partial"
  ) {
    reviewStatus = "auto_processed";
  } else if (confidence.humanReviewRequired) {
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
    detectedVendorName:
      formatId === "unknown" ? undefined : vendorDisplayNameForFormat(formatId),
  };
}

/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
export function expectedInvoiceLines(result: InvoiceProcessingResult) {
  return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
