import { useMemo, useState } from "react";
import type { DeliveryDetails, Item } from "../models";
import { MATERIAL_ISSUE_TYPE_LABEL } from "../models";
import { computeDeliveryReadiness } from "../readiness";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "../email/getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "../email/emailApplyConflicts";
import { proposalNeedsDrawerReview } from "../email/emailReviewHelpers";
import { buildNeedMoreInfoDraft } from "./needMoreInfoDraft";

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

function itemReceiptSummary(items: Item[]): { ordered: number; received: number } {
  return items.reduce(
    (acc, item) => ({
      ordered: acc.ordered + item.qtyOrdered,
      received: acc.received + item.qtyReceived,
    }),
    { ordered: 0, received: 0 },
  );
}

function telDigits(phone: string): string {
  return phone.replace(/\D/g, "");
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
  const [needMoreInfoOpen, setNeedMoreInfoOpen] = useState(false);

  const { delivery, items, materialIssues, purchaseOrder } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;
  const vendorPhone = details.vendor.contactPhone?.trim() ?? "";
  const telHref = vendorPhone ? `tel:${telDigits(vendorPhone)}` : null;

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

  const blockerLabels: string[] = [];
  if (emailReviewRequired) {
    blockerLabels.push("Vendor email needs review");
  }
  for (const reason of blockReasons) {
    const label = BLOCK_LABEL[reason];
    if (label && !blockerLabels.includes(label)) {
      blockerLabels.push(label);
    }
  }
  if (
    !details.stagingLocation &&
    items.some((item) => item.qtyReceived > 0) &&
    !blockerLabels.includes("Staging location not assigned")
  ) {
    blockerLabels.push("Missing staging assignment");
  }
  for (const issue of blockingIssues) {
    const line = `${MATERIAL_ISSUE_TYPE_LABEL[issue.type]}: ${issue.description?.trim() || "No description"}`;
    if (!blockerLabels.includes(line)) {
      blockerLabels.push(line);
    }
  }

  const allClear =
    readiness.readyForPickup && !emailReviewRequired && blockerLabels.length === 0;

  const missingLines = missingItemLines(items);
  const receipt = itemReceiptSummary(items);
  const needMoreInfoDraft = buildNeedMoreInfoDraft(details);

  return (
    <>
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
                : `Received ${receipt.received} of ${receipt.ordered} items ordered`}
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

        {!allClear && missingLines.length > 0 && (
          <ul
            data-testid="drawer-action-banner-missing-items"
            style={{
              margin: "0 0 10px",
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

        {!allClear && blockerLabels.length > 0 && (
          <ul
            data-testid="drawer-action-banner-blockers"
            style={{
              margin: missingLines.length > 0 ? "0 0 12px" : "0 0 12px",
              paddingLeft: 18,
              fontSize: 13,
              color: "#7f1d1d",
            }}
          >
            {blockerLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}

        {!allClear && (
          <div
            data-testid="drawer-action-banner-buttons"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
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
            {telHref ? (
              <a
                href={telHref}
                data-testid="drawer-action-call-vendor"
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: "#fff",
                  color: navy,
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                  fontFamily: font,
                }}
              >
                Call Vendor
              </a>
            ) : (
              <button
                type="button"
                data-testid="drawer-action-call-vendor"
                disabled
                title="No vendor phone number saved"
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
            )}
            <button
              type="button"
              data-testid="drawer-action-need-more-info"
              onClick={() => setNeedMoreInfoOpen(true)}
              style={{
                padding: "7px 12px",
                borderRadius: 6,
                border: `1.5px solid ${navy}`,
                backgroundColor: "#fff",
                color: navy,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Need More Info
            </button>
          </div>
        )}

        {!allClear && (
          <p
            data-testid="drawer-vendor-phone-line"
            style={{
              margin: "10px 0 0",
              fontSize: 12,
              color: vendorPhone ? "#334155" : "#9ca3af",
            }}
          >
            {vendorPhone ? (
              <>
                Vendor phone:{" "}
                {telHref ? (
                  <a
                    href={telHref}
                    data-testid="drawer-vendor-phone-link"
                    style={{ color: navy, fontWeight: 700 }}
                  >
                    {vendorPhone}
                  </a>
                ) : (
                  vendorPhone
                )}
              </>
            ) : (
              <span data-testid="drawer-vendor-phone-missing">
                No vendor phone number saved
              </span>
            )}
          </p>
        )}
      </section>

      {needMoreInfoOpen && (
        <div
          data-testid="need-more-info-modal"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setNeedMoreInfoOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              backgroundColor: "#fff",
              borderRadius: 10,
              padding: 20,
              boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
              fontFamily: font,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 16,
                fontWeight: 700,
                color: navy,
              }}
            >
              Need More Info — draft message
            </h3>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 12,
                color: "#64748b",
              }}
            >
              Copy and contact the vendor manually. Automated send is not available yet.
            </p>
            {needMoreInfoDraft ? (
              <textarea
                readOnly
                data-testid="need-more-info-draft"
                value={needMoreInfoDraft}
                rows={12}
                style={{
                  width: "100%",
                  marginBottom: 14,
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "vertical",
                  backgroundColor: "#f8fafc",
                }}
              />
            ) : (
              <p
                data-testid="need-more-info-deferred"
                style={{
                  margin: "0 0 14px",
                  padding: "12px",
                  borderRadius: 6,
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                  color: "#475569",
                }}
              >
                Request-info draft is not available — no open issues or missing items to
                include. Contact the vendor by phone or review email evidence below.
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                data-testid="need-more-info-close"
                onClick={() => setNeedMoreInfoOpen(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: navy,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
