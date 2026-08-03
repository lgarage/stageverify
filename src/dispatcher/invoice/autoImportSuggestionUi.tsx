import type { VendorInvoiceImportReview } from "../models";
import {
  resolveAutoImportEligibility,
  type ImportDecisionMode,
} from "./computeAutoImportEligibility";

const NAVY = "#0a3161";

const MODE_STYLES: Record<
  ImportDecisionMode,
  { bg: string; color: string; label: string }
> = {
  suggested_import: {
    bg: "#ecfdf5",
    color: "#166534",
    label: "Suggested import",
  },
  review_required: {
    bg: "#fff7ed",
    color: "#9a3412",
    label: "Review required",
  },
  blocked: {
    bg: "#fef2f2",
    color: "#991b1b",
    label: "Blocked",
  },
};

export function AutoImportSuggestionBadge({
  importRow,
  compact = false,
}: {
  importRow: VendorInvoiceImportReview;
  compact?: boolean;
}) {
  if (importRow.reviewStatus !== "pending_review") return null;

  const eligibility = resolveAutoImportEligibility({
    importStatus: importRow.importStatus,
    confidenceScore: importRow.confidenceScore,
    humanReviewRequired: importRow.humanReviewRequired,
    duplicate: importRow.duplicate,
    parseWarnings: importRow.parseWarnings,
    parsedHeader: importRow.parsedHeader,
    parsedLines: importRow.parsedLines,
    parsedLineCount: importRow.parsedLineCount,
    pageId: importRow.pageId,
    parserFormatId: importRow.parserFormatId,
    autoImportEligible: importRow.autoImportEligible,
    autoImportConfidence: importRow.autoImportConfidence,
    autoImportReasons: importRow.autoImportReasons,
    reviewRequiredReasons: importRow.reviewRequiredReasons,
    importDecisionMode: importRow.importDecisionMode,
    suggestedAction: importRow.suggestedAction,
  });

  const style = MODE_STYLES[eligibility.importDecisionMode];
  const reasons =
    eligibility.importDecisionMode === "suggested_import"
      ? eligibility.autoImportReasons
      : eligibility.reviewRequiredReasons;
  const tooltip = [eligibility.suggestedAction, ...reasons.slice(0, 6)].join("\n");

  return (
    <span
      data-testid="invoice-auto-import-badge"
      data-decision-mode={eligibility.importDecisionMode}
      title={tooltip}
      style={{
        backgroundColor: style.bg,
        color: style.color,
        fontWeight: 700,
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 999,
        whiteSpace: compact ? "nowrap" : "normal",
        maxWidth: compact ? 220 : 480,
        display: "inline-block",
      }}
    >
      {style.label}
      {!compact && eligibility.autoImportConfidence > 0
        ? ` · ${eligibility.autoImportConfidence}%`
        : ""}
    </span>
  );
}

export function AutoImportSuggestionPanel({
  importRow,
}: {
  importRow: VendorInvoiceImportReview;
}) {
  const eligibility = resolveAutoImportEligibility({
    importStatus: importRow.importStatus,
    confidenceScore: importRow.confidenceScore,
    humanReviewRequired: importRow.humanReviewRequired,
    duplicate: importRow.duplicate,
    parseWarnings: importRow.parseWarnings,
    parsedHeader: importRow.parsedHeader,
    parsedLines: importRow.parsedLines,
    parsedLineCount: importRow.parsedLineCount,
    pageId: importRow.pageId,
    parserFormatId: importRow.parserFormatId,
    autoImportEligible: importRow.autoImportEligible,
    autoImportConfidence: importRow.autoImportConfidence,
    autoImportReasons: importRow.autoImportReasons,
    reviewRequiredReasons: importRow.reviewRequiredReasons,
    importDecisionMode: importRow.importDecisionMode,
    suggestedAction: importRow.suggestedAction,
  });

  const reasons =
    eligibility.importDecisionMode === "suggested_import"
      ? eligibility.autoImportReasons
      : eligibility.reviewRequiredReasons;

  return (
    <div
      data-testid="invoice-auto-import-suggestion"
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${eligibility.importDecisionMode === "suggested_import" ? "#bbf7d0" : "#fed7aa"}`,
        backgroundColor:
          eligibility.importDecisionMode === "suggested_import" ? "#f0fdf4" : "#fffbeb",
      }}
    >
      <div style={{ fontWeight: 700, color: NAVY, fontSize: 13, marginBottom: 6 }}>
        {eligibility.suggestedAction}
      </div>
      {reasons.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 12,
            color: "#374151",
            lineHeight: 1.45,
          }}
        >
          {reasons.slice(0, 8).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {importRow.importDecisionLog && importRow.importDecisionLog.length > 0 && (
        <div
          data-testid="invoice-decision-log"
          style={{ marginTop: 10, fontSize: 11, color: "#6b7280" }}
        >
          Last decision:{" "}
          {importRow.importDecisionLog[importRow.importDecisionLog.length - 1]?.action} at{" "}
          {importRow.importDecisionLog[
            importRow.importDecisionLog.length - 1
          ]?.at.slice(0, 10)}
        </div>
      )}
    </div>
  );
}
