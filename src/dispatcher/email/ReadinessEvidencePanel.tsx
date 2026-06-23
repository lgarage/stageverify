import { useMemo, useState } from "react";
import type { DeliveryDetails, StagingLocation } from "../models";
import { computeDeliveryDisplayState } from "../deliveryDisplayHelpers";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "./getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "./emailApplyConflicts";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";
import {
  getHumanReviewReason,
  getSvInterpretation,
  proposalNeedsDrawerReview,
} from "./emailReviewHelpers";
import { READINESS_BLOCK_LABEL } from "../deliveryDisplayHelpers";

const BLOCK_LABEL: Record<string, string> = READINESS_BLOCK_LABEL;

function EmailEvidenceCard({ row }: { row: ProposedEmailUpdate }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const interpretation = getSvInterpretation(row);
  const needsReview = proposalNeedsDrawerReview(row);

  return (
    <div
      data-testid={`email-evidence-card-${row.messageId}`}
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e0e3e8",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
          {row.vendorName ?? row.senderEmail}
        </span>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          {row.receivedAt.slice(0, 10)}
        </span>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "#475569" }}>
        {row.subject}
        {row.poNumber ? (
          <span style={{ fontFamily: "monospace", marginLeft: 6 }}>{row.poNumber}</span>
        ) : null}
      </p>

      {needsReview ? (
        <p
          data-testid={`email-evidence-review-${row.messageId}`}
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            fontWeight: 600,
            color: "#b45309",
          }}
        >
          Review Required — {getHumanReviewReason(row)}
        </p>
      ) : null}

      {interpretation.length > 0 && (
        <div
          data-testid={`email-evidence-interpretation-${row.messageId}`}
          style={{ marginBottom: 8, fontSize: 12, color: "#334155" }}
        >
          <span style={{ fontWeight: 700, fontSize: 11, color: "#64748b" }}>
            SV Interpretation:{" "}
          </span>
          {interpretation.map((line) => (
            <span key={line.label} style={{ marginRight: 10 }}>
              {line.ok ? "✓" : "○"} {line.label}
            </span>
          ))}
        </div>
      )}

      <p
        data-testid={`email-evidence-classification-${row.messageId}`}
        style={{ margin: "0 0 6px", fontSize: 11, color: "#64748b" }}
      >
        {row.classification.replace(/_/g, " ")} · {row.receivedAt.slice(0, 16).replace("T", " ")}
      </p>

      {row.itemLines.length > 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b" }}>
          {row.itemLines.length} parsed line(s)
        </p>
      )}

      {row.condition1ApprovalNote && (
        <p
          data-testid={`email-evidence-condition1-note-${row.messageId}`}
          style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b" }}
        >
          {row.condition1ApprovalNote}
        </p>
      )}

      <button
        type="button"
        data-testid={`email-evidence-view-original-${row.messageId}`}
        onClick={() => setShowOriginal((v) => !v)}
        style={{
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid #0a3161",
          backgroundColor: "#fff",
          color: "#0a3161",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {showOriginal ? "Hide Original Email" : "View Original Email"}
      </button>

      {showOriginal && (
        <div
          data-testid={`email-evidence-original-${row.messageId}`}
          style={{
            marginTop: 10,
            padding: "10px 12px",
            backgroundColor: "#f8fafc",
            borderRadius: 4,
            fontSize: 12,
            color: "#334155",
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>From:</strong> {row.senderEmail}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>To:</strong> {row.recipientEmails.join(", ")}
          </div>
          {row.threadId ? (
            <div style={{ marginBottom: 4 }}>
              <strong>Thread:</strong> {row.threadId}
            </div>
          ) : null}
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {new Date(row.receivedAt).toLocaleString()}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {row.subject}
          </div>
          <pre
            data-testid={`email-evidence-original-body-${row.messageId}`}
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {row.originalBody}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ReadinessEvidencePanel({
  details,
  stagingLocations,
  navy,
  font,
}: {
  details: DeliveryDetails;
  stagingLocations: StagingLocation[];
  navy: string;
  font: string;
}) {
  const { delivery, items, materialIssues, purchaseOrder } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;

  const proposals = useMemo(() => {
    const all = getProposedEmailUpdates();
    return filterProposalsForDelivery(all, delivery, poNumber);
  }, [delivery, poNumber]);

  const [emailEvidenceOpen, setEmailEvidenceOpen] = useState(false);

  const displayState = useMemo(
    () => computeDeliveryDisplayState(delivery, items, materialIssues),
    [delivery, items, materialIssues],
  );
  const readiness = displayState.readiness;

  const openIssues = materialIssues.filter(
    (i) => i.status === "open" || i.status === "assigned",
  );
  const blockingIssues = openIssues.filter((i) => i.blocking);

  const additionalSpots = (delivery.additionalStagingLocationIds ?? [])
    .map((id) => stagingLocations.find((loc) => loc.id === id))
    .filter((loc): loc is StagingLocation => Boolean(loc));

  const itemConflicts = items.filter(
    (item) => item.qtyMissing > 0 || item.qtyDamaged > 0 || item.qtyBackordered > 0,
  );

  const blockReasons = readiness.evidence.readinessBlockReasons;

  const emailAutoApplied =
    delivery.vendorOrderComplete === true &&
    delivery.vendorOrderCompleteSource === "vendor_email";

  const proposalReviewRequired = proposals.some((row) => {
    if (row.reviewStatus === "pending_review" || row.reviewStatus === "rejected") {
      return row.affectsCondition1;
    }
    if (row.reviewStatus === "auto_processed" && !emailAutoApplied) {
      const conflict = hasVendorOrderCompleteApplyConflict(
        delivery,
        items,
        {
          classification: row.classification,
          poNumbers: row.poNumber ? [row.poNumber] : [],
          orderNumbers: row.matchedOrderLabel ? [row.matchedOrderLabel] : [],
          jobNumbers: row.matchedJobNumber ? [row.matchedJobNumber] : [],
          itemLines: row.itemLines,
          vendorOrderCompleteClaim: row.classification === "vendor_order_complete",
        },
      );
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

  const condition1ReviewRequired = proposalReviewRequired || twoSourceConflict;
  const condition1Complete = emailAutoApplied && !twoSourceConflict;

  return (
    <div
      data-testid="readiness-evidence-panel"
      style={{
        backgroundColor: "#f8fafc",
        border: "1px solid #e0e3e8",
        borderRadius: 8,
        padding: "15px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: font,
      }}
    >
      <div data-testid="readiness-evidence-condition1">
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 11,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Condition 1 — Vendor Order Evidence
        </p>
        {condition1Complete ? (
          <p
            data-testid="readiness-evidence-condition1-status"
            style={{
              margin: "0 0 10px",
              fontSize: 13,
              fontWeight: 700,
              color: "#2e7d32",
            }}
          >
            ✓ Complete
            {delivery.vendorOrderCompleteAt
              ? ` · auto-applied ${new Date(delivery.vendorOrderCompleteAt).toLocaleString()}`
              : ""}
            {delivery.vendorOrderCompleteConfidence !== undefined
              ? ` · ${delivery.vendorOrderCompleteConfidence}% confidence`
              : ""}
          </p>
        ) : condition1ReviewRequired ? (
          <p
            data-testid="readiness-evidence-condition1-status"
            style={{
              margin: "0 0 10px",
              fontSize: 13,
              fontWeight: 700,
              color: "#b45309",
            }}
          >
            Review Required
            {twoSourceConflict
              ? " — vendor email and physical delivery information conflict"
              : ""}
          </p>
        ) : null}
        <p
          data-testid="readiness-evidence-condition1-note"
          style={{
            margin: 0,
            fontSize: 11,
            color: "#64748b",
            fontStyle: "italic",
          }}
        >
          Email evidence supports readiness but does not determine readiness.
        </p>
      </div>

      <div
        data-testid="email-evidence-section"
        style={{ borderTop: "1px solid #eaecf0", paddingTop: 12 }}
      >
        <button
          type="button"
          data-testid="email-evidence-toggle"
          onClick={() => setEmailEvidenceOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            fontFamily: font,
            textAlign: "left",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: navy,
              letterSpacing: "0.02em",
            }}
          >
            Email Evidence ({proposals.length})
          </span>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {emailEvidenceOpen ? "Collapse" : "Expand"}
          </span>
        </button>

        {emailEvidenceOpen && (
          <div
            data-testid="email-evidence-list"
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {proposals.length === 0 ? (
              <p
                data-testid="email-evidence-empty"
                style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}
              >
                No matched email evidence for this delivery.
              </p>
            ) : (
              proposals.map((row) => (
                <EmailEvidenceCard key={row.messageId} row={row} />
              ))
            )}
          </div>
        )}
      </div>

      <div
        data-testid="readiness-evidence-condition2"
        style={{ borderTop: "1px solid #eaecf0", paddingTop: 12 }}
      >
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 11,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Condition 2 — Physical Delivery Evidence
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>Vendor DELIVERED</span>
            <span data-testid="readiness-evidence-vendor-delivered">
              {delivery.vendorPhysicalDropoffConfirmed ? "Yes" : "No"}
              {delivery.deliveredAt
                ? ` · ${new Date(delivery.deliveredAt).toLocaleString()}`
                : delivery.vendorPhysicalDropoffConfirmedAt
                  ? ` · ${new Date(delivery.vendorPhysicalDropoffConfirmedAt).toLocaleString()}`
                  : ""}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>Staging location</span>
            <span data-testid="readiness-evidence-staging">
              {details.stagingLocation
                ? `${details.stagingLocation.code} — ${details.stagingLocation.label}`
                : "—"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>Material issues</span>
            <span data-testid="readiness-evidence-material-issues">
              {openIssues.length === 0
                ? "None open"
                : `${openIssues.length} open (${blockingIssues.length} blocking)`}
            </span>
          </div>
          <div>
            <span
              style={{
                color: "#6b7280",
                fontWeight: 600,
                display: "block",
                marginBottom: 4,
              }}
            >
              Need More Space history
            </span>
            {additionalSpots.length === 0 ? (
              <span
                data-testid="readiness-evidence-need-more-space"
                style={{ color: "#9ca3af", fontSize: 12 }}
              >
                No additional staging spots added.
              </span>
            ) : (
              <ul
                data-testid="readiness-evidence-need-more-space"
                style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}
              >
                {additionalSpots.map((loc) => (
                  <li key={loc.id}>
                    {loc.code} — {loc.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div
        data-testid="readiness-evidence-blockers"
        style={{ borderTop: "1px solid #eaecf0", paddingTop: 12 }}
      >
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 11,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Blockers
        </p>
        {blockReasons.length === 0 &&
        openIssues.length === 0 &&
        !details.stagingLocation &&
        itemConflicts.length === 0 ? (
          <p
            data-testid="readiness-evidence-blockers-none"
            style={{ margin: 0, fontSize: 13, color: "#2e7d32", fontWeight: 600 }}
          >
            No blockers identified for this delivery.
          </p>
        ) : (
          <ul
            style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#334155" }}
          >
            {blockReasons.map((reason) => (
              <li key={reason} data-testid={`readiness-evidence-blocker-${reason}`}>
                {BLOCK_LABEL[reason] ?? reason}
              </li>
            ))}
            {!details.stagingLocation &&
              items.some((item) => item.qtyReceived > 0) && (
                <li data-testid="readiness-evidence-blocker-missing-staging">
                  Missing staging assignment
                </li>
              )}
            {openIssues.map((issue) => (
              <li key={issue.id} data-testid={`readiness-evidence-blocker-issue-${issue.id}`}>
                Open issue: {issue.description?.trim() || issue.type}
                {issue.blocking ? " (blocking)" : ""}
              </li>
            ))}
            {itemConflicts.map((item) => (
              <li key={item.id} data-testid={`readiness-evidence-blocker-item-${item.id}`}>
                Unresolved item conflict: {item.description}
                {item.qtyMissing > 0 ? ` · ${item.qtyMissing} missing` : ""}
                {item.qtyDamaged > 0 ? ` · ${item.qtyDamaged} damaged` : ""}
                {item.qtyBackordered > 0 ? ` · ${item.qtyBackordered} backordered` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
