import { useEffect, useRef } from "react";
import type { VendorInvoiceImportReview } from "../models";
import { InvoiceReviewPanel } from "../invoice/InvoiceReviewPanel";
import { NeedsReviewEmailStrip } from "./NeedsReviewEmailStrip";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * Delivery Overview Needs Review area: vendor email strip + full invoice import
 * queue (same InvoiceReviewPanel as the former Invoice Review page).
 */
export function NeedsReviewSection({
  syncedImports,
  refreshGeneration = 0,
  backfillErrors = null,
  onApproveSuccess,
  focusOnMount = false,
}: {
  syncedImports?: VendorInvoiceImportReview[] | null;
  refreshGeneration?: number;
  backfillErrors?: string[] | null;
  onApproveSuccess?: () => Promise<void>;
  focusOnMount?: boolean;
}) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusOnMount) return;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusOnMount]);

  return (
    <section
      ref={sectionRef}
      id="needs-review"
      data-testid="needs-review-section"
      style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <NeedsReviewEmailStrip />

      <div data-testid="needs-review-invoice-block">
        <div style={{ marginBottom: 12 }}>
          <h2
            data-testid="needs-review-invoice-heading"
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: NAVY,
              margin: 0,
              lineHeight: "1.2",
            }}
          >
            Invoice imports
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "#6b7280",
              margin: "4px 0 0",
            }}
          >
            Review parsed Johnstone invoices from inbound email. Approve applies
            expected items only — no shop receipt or readiness changes.
          </p>
        </div>
        <InvoiceReviewPanel
          syncedImports={syncedImports}
          refreshGeneration={refreshGeneration}
          backfillErrors={backfillErrors}
          onApproveSuccess={onApproveSuccess}
        />
      </div>
    </section>
  );
}
