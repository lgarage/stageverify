import { useMemo } from "react";
import type { DeliveryDetails, StagingLocation } from "../models";
import { computeDeliveryReadiness } from "../readiness";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "./getProposedEmailUpdates";

const BLOCK_LABEL: Record<string, string> = {
  vendor_order_incomplete: "Vendor order not complete",
  physical_dropoff_incomplete: "Physical drop-off not complete",
  staging_assignment_incomplete: "Staging location not assigned",
  unresolved_blocking_issues: "Open blocking material issues",
  unresolved_damage: "Unresolved damage on items",
  unresolved_backorder: "Unresolved backorder on items",
};

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#64748b",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ color: "#334155", lineHeight: 1.45 }}>{children}</div>
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

  const readiness = useMemo(
    () => computeDeliveryReadiness(delivery, items),
    [delivery, items],
  );

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

  const blockReasons = [
    ...new Set([
      ...(delivery.readinessBlockReasons ?? []),
      ...readiness.evidence.readinessBlockReasons,
    ]),
  ];

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
        {proposals.length === 0 ? (
          <p
            data-testid="readiness-evidence-condition1-empty"
            style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}
          >
            No offline email proposals matched this delivery.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {proposals.map((row) => (
              <div
                key={row.messageId}
                data-testid={`readiness-evidence-email-${row.messageId}`}
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e0e3e8",
                  borderRadius: 6,
                  padding: "12px",
                }}
              >
                <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#333" }}>
                  {row.subject}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "4px 16px",
                    fontSize: 12,
                  }}
                >
                  <DetailField label="Confidence">
                    <span data-testid={`readiness-evidence-confidence-${row.messageId}`}>
                      {row.confidenceScore}% — {row.confidenceReason}
                    </span>
                  </DetailField>
                  <DetailField label="Matched Job #">
                    {row.matchedJobNumber ?? "—"}
                  </DetailField>
                  <DetailField label="Matched PO #">
                    <span style={{ fontFamily: "monospace" }}>
                      {row.matchedPoLabel ?? "—"}
                    </span>
                  </DetailField>
                  <DetailField label="Matched Order #">
                    <span style={{ fontFamily: "monospace" }}>
                      {row.matchedOrderLabel ?? "—"}
                    </span>
                  </DetailField>
                  <DetailField label="Matched Delivery">
                    {row.matchedDeliveryLabel ?? "—"}
                  </DetailField>
                </div>
                <DetailField label="Parsed meaning">
                  {row.proposedOperationalMeaning}
                </DetailField>
                <DetailField label="Source email excerpt">
                  <blockquote
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      borderLeft: "3px solid #cbd5e1",
                      backgroundColor: "#f8fafc",
                      color: "#475569",
                      fontStyle: "italic",
                      fontSize: 12,
                    }}
                  >
                    {row.bodyExcerpt}
                  </blockquote>
                </DetailField>
              </div>
            ))}
          </div>
        )}
        <p
          data-testid="readiness-evidence-condition1-note"
          style={{
            margin: "10px 0 0",
            fontSize: 11,
            color: "#64748b",
            fontStyle: "italic",
          }}
        >
          Email evidence supports readiness but does not determine readiness.
        </p>
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
