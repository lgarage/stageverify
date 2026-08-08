import type { InvoiceMatchResult, VendorInvoiceImportReview } from "../models";
import { formatInvoiceMatchReasons } from "./invoiceMatchReasonLabels";
import { shellDeliveryIdForImport } from "./invoiceShellDisplayHelpers";


/** Informational only — Approve always creates a new shell; linking was removed. */
export function InvoiceDeliveryMatchSection({
  importRow,
  matchResult,
  matchLoading,
  matchUnavailable,
  shipDateWarning,
}: {
  importRow: VendorInvoiceImportReview;
  matchResult: InvoiceMatchResult | null;
  matchLoading: boolean;
  matchUnavailable: string | null;
  shipDateWarning: string | null;
  /** @deprecated Linking removed — ignored. */
  selectedDeliveryId?: string;
  /** @deprecated Linking removed — ignored. */
  onSelectDelivery?: (deliveryId: string) => void;
  recentDeliveries?: unknown;
  recentDeliveriesLoading?: boolean;
}) {
  if (importRow.reviewStatus !== "pending_review" && importRow.reviewStatus !== "rejected") {
    return null;
  }

  const willCreateShellId = shellDeliveryIdForImport(importRow.id);

  return (
    <div
      data-testid="invoice-delivery-match-section"
      style={{
        marginBottom: 20,
        padding: "14px 16px",
        backgroundColor: "var(--admin-surface-2)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--admin-text-label)", margin: "0 0 10px" }}>
        Delivery on Approve
      </h3>
      <p
        data-testid="invoice-delivery-will-create"
        style={{
          fontSize: 12,
          color: "var(--admin-text-label)",
          margin: "0 0 12px",
          lineHeight: 1.45,
          padding: "8px 10px",
          backgroundColor: "var(--admin-info-bg)",
          borderRadius: 6,
          border: "1px solid var(--admin-info-border)",
        }}
      >
        Approve creates a new dashboard delivery{" "}
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
          {willCreateShellId}
        </span>
        {" "}
        for this invoice (one row per invoice).
      </p>

      {shipDateWarning && (
        <p
          data-testid="invoice-review-ship-date-warning"
          style={{ fontSize: 12, color: "var(--admin-warning-text)", margin: "0 0 10px", lineHeight: 1.4 }}
        >
          {shipDateWarning}
        </p>
      )}

      {matchUnavailable && (
        <p
          data-testid="invoice-review-match-unavailable"
          style={{ fontSize: 12, color: "var(--admin-warning-text)", margin: "0 0 10px", lineHeight: 1.4 }}
        >
          {matchUnavailable}
        </p>
      )}

      {matchLoading && !matchUnavailable && (
        <p data-testid="invoice-delivery-match-loading" style={{ fontSize: 12, color: "var(--admin-text-muted)", margin: 0 }}>
          Checking related records…
        </p>
      )}

      {!matchLoading && !matchUnavailable && matchResult && (
        <p
          data-testid="invoice-delivery-match-confidence"
          style={{ fontSize: 12, color: "var(--admin-text-muted)", margin: 0 }}
        >
          {formatInvoiceMatchReasons(matchResult.confidenceReason)}
        </p>
      )}
    </div>
  );
}
