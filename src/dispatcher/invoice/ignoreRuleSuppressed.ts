/**
 * D-59 P4 — ignore rule matched but suppressed by strong invoice signals.
 */
import type { VendorInvoiceImportReview } from "../models";

export const IGNORE_RULE_SUPPRESSED_REASON = "strong_invoice_signals" as const;

export const IGNORE_RULE_SUPPRESSED_ADVISORY_LABEL =
  "Ignore rule matched but suppressed — strong invoice signals (stays in review)";

/** Pending imports where a taught ignore rule would have skipped but signals blocked it. */
export function ignoreRuleSuppressedAdvisoryLabel(
  importRow: Pick<
    VendorInvoiceImportReview,
    "reviewStatus" | "ignoreRuleSuppressedBy" | "skipReason"
  >,
): string | null {
  if (importRow.reviewStatus !== "pending_review") return null;
  if (importRow.ignoreRuleSuppressedBy !== IGNORE_RULE_SUPPRESSED_REASON) {
    return null;
  }
  if (importRow.skipReason) return null;
  return IGNORE_RULE_SUPPRESSED_ADVISORY_LABEL;
}
