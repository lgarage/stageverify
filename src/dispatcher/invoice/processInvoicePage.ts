import { deriveImportStatus, scoreInvoiceConfidence } from "./inferImportStatus";
import { pageTextFingerprint, parseJohnstoneInvoicePage } from "./parseJohnstoneInvoice";
import type { InvoiceProcessingResult, JohnstoneInvoicePageText } from "./types";
import { INVOICE_AUTO_APPLY_CONFIDENCE } from "./types";

export interface ExistingInvoiceIndex {
  byPageId: Map<string, string>;
  byFingerprint: Map<string, string>;
}

export function processInvoicePage(
  page: JohnstoneInvoicePageText,
  existing: ExistingInvoiceIndex,
): InvoiceProcessingResult {
  const parsed = parseJohnstoneInvoicePage(page);
  const fingerprint = pageTextFingerprint(page);
  const importStatus = deriveImportStatus(parsed);
  const confidence = scoreInvoiceConfidence(parsed);

  const duplicateOfPage = existing.byPageId.get(page.pageId);
  const duplicateOfFingerprint = existing.byFingerprint.get(fingerprint);
  const duplicate = Boolean(duplicateOfPage || duplicateOfFingerprint);

  let reviewStatus: InvoiceProcessingResult["reviewStatus"] = "pending_review";
  if (duplicate) {
    reviewStatus = "rejected";
  } else if (importStatus === "issue") {
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
    humanReviewRequired: confidence.humanReviewRequired,
    duplicate,
    duplicateOfPageId: duplicateOfPage ?? duplicateOfFingerprint,
    reviewStatus,
  };
}

/** Expected vendor-order lines only — excludes core/return/freight per spec §6.2. */
export function expectedInvoiceLines(result: InvoiceProcessingResult) {
  return result.parsed.lines.filter((l) => !l.excludeFromExpectedItems);
}
