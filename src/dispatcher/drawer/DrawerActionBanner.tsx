import { useMemo, useState } from "react";
import type { DeliveryDetails } from "../models";
import {
  buildDrawerActionBannerContent,
  computeDeliveryDisplayState,
} from "../deliveryDisplayHelpers";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "../email/getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "../email/emailApplyConflicts";
import { proposalNeedsDrawerReview } from "../email/emailReviewHelpers";

function telDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function DrawerActionBanner({
  details,
  navy,
  font,
  onResolveBlockingIssue,
  onReviewIssues,
  onReviewVendorEmail,
  onEmailVendor,
}: {
  details: DeliveryDetails;
  navy: string;
  font: string;
  onResolveBlockingIssue?: () => void;
  onReviewIssues?: () => void;
  onReviewVendorEmail?: () => void;
  onEmailVendor?: () => void;
}) {
  const [callVendorOpen, setCallVendorOpen] = useState(false);

  const { delivery, items, materialIssues, purchaseOrder, vendor, job } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;
  const vendorPhone = vendor.contactPhone?.trim() ?? "";
  const vendorEmail = vendor.email?.trim() ?? "";
  const vendorAddress = vendor.address?.trim() ?? "";
  const telHref = vendorPhone ? `tel:${telDigits(vendorPhone)}` : null;

  const displayState = useMemo(
    () => computeDeliveryDisplayState(delivery, items, materialIssues),
    [delivery, items, materialIssues],
  );
  const readiness = displayState.readiness;

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

  const hasBlockingIssues = displayState.openBlockingIssueCount > 0;
  const canResolve = hasBlockingIssues && Boolean(onResolveBlockingIssue);

  const bannerContent = useMemo(
    () =>
      buildDrawerActionBannerContent(delivery, items, materialIssues, {
        emailReviewRequired,
        vendorPhone,
        vendorEmail,
      }),
    [delivery, items, materialIssues, emailReviewRequired, vendorPhone, vendorEmail],
  );

  const deliverToSitePending =
    delivery.invoiceDeliverToSite === true &&
    delivery.invoiceDeliverToSiteConfirmed !== true;

  const allClear =
    bannerContent.bannerMode === "all_clear" ||
    (readiness.readyForPickup &&
      !emailReviewRequired &&
      displayState.blockerLabels.length === 0 &&
      !deliverToSitePending);

  const calmWaiting = bannerContent.bannerMode === "calm_waiting";
  const attentionRequired =
    bannerContent.bannerMode === "attention_required" ||
    (deliverToSitePending && readiness.readyForPickup);

  const borderColor = allClear
    ? "var(--admin-success-border)"
    : calmWaiting
      ? "var(--admin-warning-border)"
      : "var(--admin-danger-border)";
  const backgroundColor = allClear
    ? "var(--admin-success-bg)"
    : calmWaiting
      ? "var(--admin-warning-bg)"
      : "var(--admin-danger-bg)";
  const headingColor = allClear
    ? "var(--admin-success-text)"
    : calmWaiting
      ? "var(--admin-warning-text)"
      : "var(--admin-danger-text)";
  const summaryColor = allClear
    ? "var(--admin-success-text)"
    : calmWaiting
      ? "var(--admin-warning-text)"
      : "var(--admin-danger-text)";
  const bannerHeading = allClear
    ? "All Clear"
    : calmWaiting
      ? "Waiting on Delivery"
      : "What Needs Attention";

  return (
    <>
      <section
        data-testid="drawer-action-banner"
        data-banner-mode={bannerContent.bannerMode}
        style={{
          borderRadius: 8,
          border: `2px solid ${borderColor}`,
          backgroundColor,
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
            marginBottom: allClear || calmWaiting ? 0 : 10,
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
                color: headingColor,
              }}
            >
              {bannerHeading}
            </p>
            <p
              data-testid="drawer-action-banner-summary"
              style={{
                margin: "6px 0 0",
                fontSize: 14,
                fontWeight: calmWaiting ? 500 : 600,
                color: summaryColor,
              }}
            >
              {bannerContent.attentionHeadline}
            </p>
          </div>
          {attentionRequired && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 11,
                fontWeight: 700,
                color: "var(--admin-danger-text)",
                backgroundColor: "var(--admin-danger-bg)",
                border: "1px solid var(--admin-danger-border)",
                borderRadius: 999,
                padding: "4px 10px",
              }}
            >
              {displayState.openBlockingIssueCount > 0
                ? `${displayState.openBlockingIssueCount} blocking`
                : "Review"}
            </span>
          )}
        </div>

        {attentionRequired && bannerContent.whyBullets.length > 0 && (
          <div data-testid="drawer-action-banner-why">
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--admin-danger-text)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Why
            </p>
            <ul
              data-testid="drawer-action-banner-blockers"
              style={{
                margin: "0 0 10px",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--admin-danger-text)",
              }}
            >
              {bannerContent.whyBullets.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}

        {attentionRequired && bannerContent.nextStepBullets.length > 0 && (
          <div data-testid="drawer-action-recommended-actions">
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--admin-danger-text)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Next Step
            </p>
            <ul
              data-testid="drawer-action-next-steps"
              style={{
                margin: "0 0 12px",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--admin-danger-text)",
              }}
            >
              {bannerContent.nextStepBullets.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        {attentionRequired && (
          <div
            data-testid="drawer-action-banner-buttons"
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}
          >
            {bannerContent.showEmailVendor && onEmailVendor && (
              <button
                type="button"
                data-testid="drawer-action-email-vendor"
                onClick={() => onEmailVendor()}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-accent-soft)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Email Vendor
              </button>
            )}
            {bannerContent.showCallVendor && (
              <button
                type="button"
                data-testid="drawer-action-call-vendor"
                onClick={() => setCallVendorOpen(true)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-accent-soft)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Call Vendor
              </button>
            )}
            {bannerContent.showReviewVendorEmail && onReviewVendorEmail && (
              <button
                type="button"
                data-testid="drawer-action-review-vendor-email"
                onClick={() => onReviewVendorEmail()}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: navy,
                  color: "var(--admin-on-navy)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Review Vendor Email
              </button>
            )}
            {bannerContent.showReviewIssues && onReviewIssues && (
              <button
                type="button"
                data-testid="drawer-action-review-issues"
                onClick={() => onReviewIssues()}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: "var(--admin-surface)",
                  color: "var(--admin-accent-soft)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Review Issues
              </button>
            )}
            {canResolve && (
              <button
                type="button"
                data-testid="drawer-action-resolve-issue"
                title={bannerContent.resolveDisabledReason}
                aria-describedby="drawer-action-resolve-hint"
                onClick={() => onResolveBlockingIssue?.()}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${navy}`,
                  backgroundColor: navy,
                  color: "var(--admin-on-navy)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Resolve Issue
              </button>
            )}
          </div>
        )}

        {attentionRequired && canResolve && (
          <p
            id="drawer-action-resolve-hint"
            data-testid="drawer-action-resolve-hint"
            style={{
              margin: "8px 0 0",
              fontSize: 12,
              color: "var(--admin-danger-text)",
              fontStyle: "italic",
            }}
          >
            {bannerContent.resolveDisabledReason}
          </p>
        )}

        {attentionRequired && bannerContent.showCallVendor && (
          <p
            data-testid="drawer-vendor-phone-line"
            style={{
              margin: "10px 0 0",
              fontSize: 12,
              color: "var(--admin-text-data)",
              fontWeight: 600,
            }}
          >
            Vendor phone: {vendorPhone}
          </p>
        )}
      </section>

      {callVendorOpen && (
        <div
          data-testid="call-vendor-modal"
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
          onClick={() => setCallVendorOpen(false)}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: "var(--admin-surface)",
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
                color: "var(--admin-accent-soft)",
              }}
            >
              Call Vendor
            </h3>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 12,
                color: "var(--admin-text-muted)",
              }}
            >
              {delivery.orderNumber
                ? `Delivery ${delivery.orderNumber}`
                : "Delivery contact details"}
              {job ? ` · ${job.jobName}` : ""}
            </p>
            <dl
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: "var(--admin-text-data)",
              }}
            >
              <div style={{ marginBottom: 10 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Vendor</dt>
                <dd style={{ margin: 0 }} data-testid="call-vendor-name">
                  {vendor.name}
                  {vendor.contactName ? ` (${vendor.contactName})` : ""}
                </dd>
              </div>
              <div style={{ marginBottom: 10 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Phone</dt>
                <dd style={{ margin: 0 }}>
                  {vendorPhone && telHref ? (
                    <a
                      href={telHref}
                      data-testid="call-vendor-phone-link"
                      style={{ color: "var(--admin-link)", fontWeight: 700, textDecoration: "none" }}
                    >
                      {vendorPhone}
                    </a>
                  ) : (
                    <span
                      data-testid="call-vendor-phone-missing"
                      style={{ color: "var(--admin-text-muted)" }}
                    >
                      No phone number saved for this vendor
                    </span>
                  )}
                </dd>
              </div>
              <div style={{ marginBottom: 10 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Address</dt>
                <dd style={{ margin: 0 }} data-testid="call-vendor-address">
                  {vendorAddress || (
                    <span style={{ color: "var(--admin-text-muted)" }}>No address on file</span>
                  )}
                </dd>
              </div>
              <div>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Email</dt>
                <dd style={{ margin: 0 }} data-testid="call-vendor-email">
                  {vendorEmail || (
                    <span style={{ color: "var(--admin-text-muted)" }}>No email on file</span>
                  )}
                </dd>
              </div>
            </dl>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                data-testid="call-vendor-close"
                onClick={() => setCallVendorOpen(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: navy,
                  color: "var(--admin-on-navy)",
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
