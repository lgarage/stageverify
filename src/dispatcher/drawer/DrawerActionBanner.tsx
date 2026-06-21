import { useMemo } from "react";
import type { DeliveryDetails, Item } from "../models";
import { computeDeliveryReadiness } from "../readiness";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "../email/getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "../email/emailApplyConflicts";
import { proposalNeedsDrawerReview } from "../email/emailReviewHelpers";

const BLOCK_LABEL: Record<string, string> = {
  vendor_order_incomplete: "Vendor order not complete",
  physical_dropoff_incomplete: "Physical drop-off not complete",
  staging_assignment_incomplete: "Staging location not assigned",
  unresolved_blocking_issues: "Open blocking material issues",
  unresolved_damage: "Unresolved damage on items",
  unresolved_backorder: "Unresolved backorder on items",
};

function missingItemLines(items: Item[]): string[] {
  return items
    .filter((item) => item.qtyMissing > 0)
    .map((item) => `${item.description} (${item.qtyMissing} missing)`);
}

export function DrawerActionBanner({
  details,
  navy,
  font,
  onResolveBlockingIssue,
}: {
  details: DeliveryDetails;
  navy: string;
  font: string;
  onResolveBlockingIssue?: () => void;
}) {
  const { delivery, items, materialIssues, purchaseOrder } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;

  const readiness = useMemo(
    () => computeDeliveryReadiness(delivery, items),
    [delivery, items],
  );

  const proposals = useMemo(() => {
    const all = getProposedEmailUpdates();
    return filterProposalsForDelivery(all, delivery, poNumber);
  }, [delivery, poNumber]);

  const emailAutoApplied =
    delivery.vendorOrderComplete === true &&
    delivery.vendorOrderCompleteSource === "vendor_email";

  const emailReviewRequired = useMemo(() => {
    const proposalReviewRequired = proposals.some((row) => {
      if (row.reviewStatus === "pending_review" || row.reviewStatus === "rejected") {
        return row.affectsCondition1;
      }
      if (row.reviewStatus === "auto_processed" && !emailAutoApplied) {
        const conflict = hasVendorOrderCompleteApplyConflict(delivery, items, {
          classification: row.classification,
          poNumbers: row.poNumber ? [row.poNumber] : [],
          orderNumbers: row.matchedOrderLabel ? [row.matchedOrderLabel] : [],
          jobNumbers: row.matchedJobNumber ? [row.matchedJobNumber] : [],
          itemLines: row.itemLines,
          vendorOrderCompleteClaim: row.classification === "vendor_order_complete",
        });
        return conflict !== null;
      }
      return false;
    });

    const twoSourceConflict =
      emailAutoApplied &&
      delivery.vendorPhysicalDropoffConfirmed === true &&
      items.some(
        (item) =>
          item.qtyReceived < item.qtyOrdered ||
          item.qtyBackordered > 0 ||
          item.qtyMissing > 0,
      );

    return (
      proposalReviewRequired ||
      twoSourceConflict ||
      proposals.some((row) => proposalNeedsDrawerReview(row))
    );
  }, [proposals, emailAutoApplied, delivery, items]);

  const openIssues = materialIssues.filter(
    (i) => i.status === "open" || i.status === "assigned",
  );
  const blockingIssues = openIssues.filter((i) => i.blocking);
  const hasBlockingIssues = blockingIssues.length > 0;

  const blockReasons = [
    ...new Set([
      ...(delivery.readinessBlockReasons ?? []),
      ...readiness.evidence.readinessBlockReasons,
    ]),
  ];

  const problemLabels: string[] = [];
  if (emailReviewRequired) {
    problemLabels.push("Vendor email needs review");
  }
  for (const reason of blockReasons) {
    const label = BLOCK_LABEL[reason];
    if (label && !problemLabels.includes(label)) {
      problemLabels.push(label);
    }
  }
  if (
    !details.stagingLocation &&
    items.some((item) => item.qtyReceived > 0) &&
    !problemLabels.includes("Staging location not assigned")
  ) {
    problemLabels.push("Missing staging assignment");
  }

  const allClear =
    readiness.readyForPickup && !emailReviewRequired && problemLabels.length === 0;

  const missingLines = missingItemLines(items);
  const showMissingList =
    missingLines.length > 0 ||
    blockingIssues.some((i) => i.type === "missing" || i.type === "backordered");

  return (
    <section
      data-testid="drawer-action-banner"
      style={{
        borderRadius: 8,
        border: `2px solid ${allClear ? "#2e7d32" : "#bf0a30"}`,
        backgroundColor: allClear ? "#ecfdf5" : "#fff5f5",
        padding: "14px 16px",
        fontFamily: font,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: allClear ? 0 : 10,
        }}
      >
        <div>
          <p
            data-testid="drawer-action-banner-heading"
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: allClear ? "#166534" : "#991b1b",
            }}
          >
            {allClear ? "All Clear" : "Action Required"}
          </p>
          <p
            data-testid="drawer-action-banner-summary"
            style={{
              margin: "6px 0 0",
              fontSize: 14,
              fontWeight: 600,
              color: allClear ? "#166534" : "#7f1d1d",
            }}
          >
            {allClear
              ? "Ready for Pickup — vendor order complete, physical complete, no blocking issues."
              : problemLabels.length > 0
                ? problemLabels.join(" · ")
                : "Not ready for pickup — see Readiness Evidence below."}
          </p>
        </div>
        {!allClear && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 700,
              color: "#991b1b",
              backgroundColor: "#fee2e2",
              border: "1px solid #fca5a5",
              borderRadius: 999,
              padding: "4px 10px",
            }}
          >
            {(delivery.openBlockingIssueCount ?? blockingIssues.length) > 0
              ? `${delivery.openBlockingIssueCount ?? blockingIssues.length} blocking`
              : "Review"}
          </span>
        )}
      </div>

      {!allClear && showMissingList && missingLines.length > 0 && (
        <ul
          data-testid="drawer-action-banner-missing-items"
          style={{
            margin: "0 0 12px",
            paddingLeft: 18,
            fontSize: 13,
            color: "#7f1d1d",
          }}
        >
          {missingLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {!allClear && (
        <div
          data-testid="drawer-action-banner-buttons"
          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
        >
          <button
            type="button"
            data-testid="drawer-action-resolve-issue"
            disabled={!hasBlockingIssues || !onResolveBlockingIssue}
            title={
              hasBlockingIssues
                ? "Open resolve flow for first blocking material issue"
                : "No open blocking material issues"
            }
            onClick={() => onResolveBlockingIssue?.()}
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: `1.5px solid ${navy}`,
              backgroundColor: hasBlockingIssues ? navy : "#fff",
              color: hasBlockingIssues ? "#fff" : "#9ca3af",
              fontSize: 12,
              fontWeight: 700,
              cursor: hasBlockingIssues && onResolveBlockingIssue ? "pointer" : "not-allowed",
              fontFamily: font,
              opacity: hasBlockingIssues ? 1 : 0.7,
            }}
          >
            Resolve Issue
          </button>
          <button
            type="button"
            data-testid="drawer-action-call-vendor"
            disabled
            title="Phase 6 — vendor callback workflow not yet available"
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: "1.5px solid #cbd5e1",
              backgroundColor: "#f8fafc",
              color: "#94a3b8",
              fontSize: 12,
              fontWeight: 700,
              cursor: "not-allowed",
              fontFamily: font,
            }}
          >
            Call Vendor
          </button>
          <button
            type="button"
            data-testid="drawer-action-need-more-info"
            disabled
            title="Phase 6 — request-info workflow not yet available"
            style={{
              padding: "7px 12px",
              borderRadius: 6,
              border: "1.5px solid #cbd5e1",
              backgroundColor: "#f8fafc",
              color: "#94a3b8",
              fontSize: 12,
              fontWeight: 700,
              cursor: "not-allowed",
              fontFamily: font,
            }}
          >
            Need More Info
          </button>
        </div>
      )}
    </section>
  );
}
