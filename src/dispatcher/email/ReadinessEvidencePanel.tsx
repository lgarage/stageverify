import { useEffect, useMemo, useState } from "react";
import type { DeliveryDetails, InboundEmailProcessing, StagingLocation, VendorEmailEvent } from "../models";
import { computeDeliveryDisplayState } from "../deliveryDisplayHelpers";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "./getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "./emailApplyConflicts";
import { READINESS_BLOCK_LABEL } from "../deliveryDisplayHelpers";
import { listVendorEmailEventsForDelivery, getVendorInvoiceImport, getInboundEmailProcessing } from "../firestoreService";
import {
  EmailEvidenceCard,
  InvoiceSourceEmailCard,
  VendorEmailEventCard,
} from "./emailEvidenceCards";
import { ReviewVendorEmailModal } from "../drawer/ReviewVendorEmailModal";
import {
  buildMaterialIssuesEvidenceSnapshot,
  buildPhysicalDeliveryEvidenceSnapshot,
  buildStagingEvidenceSnapshot,
  computeItemConflicts,
} from "./readinessEvidenceSnapshots";

const BLOCK_LABEL: Record<string, string> = READINESS_BLOCK_LABEL;

const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  vendor_email: "Vendor email",
  physical_checkin: "Physical check-in",
  dispatcher: "Dispatcher confirmation",
  system: "System",
};

type SnapshotTone = "ok" | "neutral" | "attention";

function toneColor(tone: SnapshotTone): string {
  if (tone === "ok") return "var(--admin-success-text)";
  if (tone === "attention") return "var(--admin-warning-text)";
  return "var(--admin-text-muted)";
}

function formatSnapshotDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function SnapshotRow({
  label,
  value,
  tone,
  valueTestId,
}: {
  label: string;
  value: string;
  tone: SnapshotTone;
  valueTestId?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--admin-text-muted)", fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span
        data-testid={valueTestId}
        style={{
          color: toneColor(tone),
          fontWeight: 600,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function ReadinessEvidencePanel({
  details,
  stagingLocations,
  navy,
  font,
  onExpandVendorCommunications: _onExpandVendorCommunications,
  emailEvidenceExpandSignal = 0,
  reviewVendorEmailOpen = false,
  onCloseReviewVendorEmail,
}: {
  details: DeliveryDetails;
  stagingLocations: StagingLocation[];
  navy: string;
  font: string;
  onExpandVendorCommunications?: () => void;
  /** Increment to expand details + related email evidence (View Full Email Chain / legacy). */
  emailEvidenceExpandSignal?: number;
  /** Review Vendor Email — centered read-only overlay; does not expand drawer evidence. */
  reviewVendorEmailOpen?: boolean;
  onCloseReviewVendorEmail?: () => void;
}) {
  const { delivery, items, materialIssues, purchaseOrder } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;

  const proposals = useMemo(() => {
    const all = getProposedEmailUpdates();
    return filterProposalsForDelivery(all, delivery, poNumber);
  }, [delivery, poNumber]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [emailEvidenceOpen, setEmailEvidenceOpen] = useState(false);
  const [fullEmailChainOpen, setFullEmailChainOpen] = useState(false);
  const [vendorEmailEvents, setVendorEmailEvents] = useState<VendorEmailEvent[]>([]);
  const [vendorEmailEventsLoading, setVendorEmailEventsLoading] = useState(false);
  const [invoiceSourceEmail, setInvoiceSourceEmail] = useState<InboundEmailProcessing | null>(
    null,
  );
  const [invoiceSourceLoading, setInvoiceSourceLoading] = useState(false);

  const showInvoiceSourceEmail =
    invoiceSourceEmail !== null &&
    !vendorEmailEvents.some(
      (event) => event.sourceMessageId === invoiceSourceEmail.gmailMessageId,
    );

  const emailEvidenceCount =
    proposals.length + vendorEmailEvents.length + (showInvoiceSourceEmail ? 1 : 0);
  const emailEvidenceLoading = vendorEmailEventsLoading || invoiceSourceLoading;

  useEffect(() => {
    if (emailEvidenceExpandSignal > 0) {
      setDetailsOpen(true);
      setEmailEvidenceOpen(true);
    }
  }, [emailEvidenceExpandSignal]);

  useEffect(() => {
    setFullEmailChainOpen(false);
  }, [delivery.id]);

  useEffect(() => {
    let cancelled = false;
    setVendorEmailEventsLoading(true);
    void listVendorEmailEventsForDelivery(delivery.id)
      .then((rows) => {
        if (!cancelled) setVendorEmailEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setVendorEmailEvents([]);
      })
      .finally(() => {
        if (!cancelled) setVendorEmailEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [delivery.id]);

  useEffect(() => {
    const importId = delivery.vendorInvoiceImportId?.trim();
    if (!importId) {
      setInvoiceSourceEmail(null);
      setInvoiceSourceLoading(false);
      return;
    }

    let cancelled = false;
    setInvoiceSourceLoading(true);
    void getVendorInvoiceImport(importId)
      .then((row) => {
        const inboundId = row.inboundEmailProcessingId?.trim();
        if (!inboundId) {
          throw new Error("missing inbound email id");
        }
        return getInboundEmailProcessing(inboundId);
      })
      .then((inbound) => {
        if (!cancelled) setInvoiceSourceEmail(inbound);
      })
      .catch(() => {
        if (!cancelled) setInvoiceSourceEmail(null);
      })
      .finally(() => {
        if (!cancelled) setInvoiceSourceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [delivery.vendorInvoiceImportId]);

  const displayState = useMemo(
    () => computeDeliveryDisplayState(delivery, items, materialIssues),
    [delivery, items, materialIssues],
  );
  const readiness = displayState.readiness;

  const openIssues = materialIssues.filter(
    (i) => i.status === "open" || i.status === "assigned",
  );

  const additionalSpots = (delivery.additionalStagingLocationIds ?? [])
    .map((id) => stagingLocations.find((loc) => loc.id === id))
    .filter((loc): loc is StagingLocation => Boolean(loc));

  const itemsReceivedCount = items.reduce((sum, item) => sum + item.qtyReceived, 0);
  const vendorClaimsDelivered =
    delivery.vendorPhysicalDropoffConfirmed === true ||
    delivery.vendorOrderComplete === true;

  const itemConflicts = computeItemConflicts(
    items,
    itemsReceivedCount,
    vendorClaimsDelivered,
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
  const vendorOrderConfirmed =
    delivery.vendorOrderComplete === true && !twoSourceConflict;

  const vendorOrderSnapshot = (() => {
    if (vendorOrderConfirmed) {
      return { label: "Confirmed", tone: "ok" as SnapshotTone };
    }
    if (condition1ReviewRequired || proposals.length > 0) {
      return { label: "Email Evidence Found", tone: "attention" as SnapshotTone };
    }
    return { label: "Not Confirmed", tone: "neutral" as SnapshotTone };
  })();

  const physicalSnapshot = buildPhysicalDeliveryEvidenceSnapshot({
    physicalDropoffComplete: readiness.evidence.physicalDropoffComplete,
    vendorPhysicalDropoffConfirmed: delivery.vendorPhysicalDropoffConfirmed === true,
    itemConflicts,
  });

  const stagingSnapshot = buildStagingEvidenceSnapshot({
    delivery,
    stagingLocation: details.stagingLocation,
    stagingLocations,
  });

  const materialSnapshot = buildMaterialIssuesEvidenceSnapshot({
    materialIssues,
    itemConflicts,
  });

  const emailSnapshot = (() => {
    if (emailEvidenceLoading) {
      return { label: "Loading…", tone: "neutral" as SnapshotTone };
    }
    if (emailEvidenceCount === 0) {
      return { label: "No emails found", tone: "neutral" as SnapshotTone };
    }
    const latestIso = [
      ...proposals.map((row) => row.receivedAt),
      ...vendorEmailEvents.map(
        (row) => row.sentAt ?? row.receivedAt ?? row.createdAt,
      ),
      ...(showInvoiceSourceEmail && invoiceSourceEmail
        ? [invoiceSourceEmail.receivedAt]
        : []),
    ].sort((a, b) => b.localeCompare(a))[0];
    const sentCount = vendorEmailEvents.filter((e) => e.direction === "outbound").length;
    const receivedCount = vendorEmailEvents.length - sentCount;
    const parts: string[] = [];
    if (sentCount > 0) {
      parts.push(`${sentCount} sent`);
    }
    if (receivedCount > 0) {
      parts.push(`${receivedCount} received`);
    }
    if (proposals.length > 0) {
      parts.push(`${proposals.length} matched`);
    }
    const countLabel =
      parts.length > 0
        ? parts.join(", ")
        : `${emailEvidenceCount} related email${emailEvidenceCount === 1 ? "" : "s"}`;
    return {
      label: `${countLabel} · latest ${formatSnapshotDate(latestIso)}`,
      tone: "neutral" as SnapshotTone,
    };
  })();

  const hasEmailChain = emailEvidenceCount > 0;

  const handleViewFullEmailChain = () => {
    setFullEmailChainOpen(true);
  };

  return (
    <div
      data-testid="readiness-evidence-panel"
      style={{
        backgroundColor: "var(--admin-surface-2)",
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        padding: "15px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontFamily: font,
      }}
    >
      <div data-testid="readiness-evidence-snapshot">
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 11,
            fontWeight: 700,
            color: navy,
            letterSpacing: "0.02em",
          }}
        >
          Readiness snapshot
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SnapshotRow
            label="Vendor Order"
            value={vendorOrderSnapshot.label}
            tone={vendorOrderSnapshot.tone}
            valueTestId="readiness-evidence-vendor-order-snapshot"
          />
          <SnapshotRow
            label="Physical Delivery"
            value={physicalSnapshot.label}
            tone={physicalSnapshot.tone}
            valueTestId="readiness-evidence-physical-snapshot"
          />
          <SnapshotRow
            label="Staging"
            value={stagingSnapshot.label}
            tone={stagingSnapshot.tone}
            valueTestId="readiness-evidence-staging-snapshot"
          />
          <SnapshotRow
            label="Material Issues"
            value={materialSnapshot.label}
            tone={materialSnapshot.tone}
            valueTestId="readiness-evidence-material-issues"
          />
          <SnapshotRow
            label="Email Evidence"
            value={emailSnapshot.label}
            tone={emailSnapshot.tone}
            valueTestId="readiness-evidence-email-snapshot"
          />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          data-testid="readiness-evidence-details-toggle"
          onClick={() => setDetailsOpen((v) => !v)}
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            border: "1px solid var(--admin-accent)",
            backgroundColor: "var(--admin-surface)",
            color: "var(--admin-accent)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: font,
          }}
        >
          {detailsOpen ? "Hide Details" : "View Details"}
        </button>
        {hasEmailChain ? (
          <button
            type="button"
            data-testid="readiness-evidence-view-email-chain"
            onClick={handleViewFullEmailChain}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid var(--admin-border)",
              backgroundColor: "var(--admin-surface)",
              color: "var(--admin-text-secondary)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            View Full Email Chain
          </button>
        ) : (
          <span
            data-testid="readiness-evidence-no-email-chain"
            style={{ fontSize: 12, color: "var(--admin-text-muted)", padding: "6px 0" }}
          >
            No related vendor email chain found yet.
          </span>
        )}
      </div>

      {detailsOpen && (
        <div
          data-testid="readiness-evidence-details"
          style={{
            borderTop: "1px solid var(--admin-border)",
            paddingTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div data-testid="readiness-evidence-condition1">
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 700,
                color: navy,
                letterSpacing: "0.02em",
              }}
            >
              Vendor order evidence
            </p>
            {vendorOrderConfirmed ? (
              <p
                data-testid="readiness-evidence-condition1-status"
                style={{
                  margin: "0 0 8px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-success-text)",
                }}
              >
                Confirmed
                {delivery.vendorOrderCompleteAt
                  ? ` · ${formatSnapshotDate(delivery.vendorOrderCompleteAt)}`
                  : ""}
                {delivery.vendorOrderCompleteSource
                  ? ` · ${EVIDENCE_SOURCE_LABEL[delivery.vendorOrderCompleteSource] ?? delivery.vendorOrderCompleteSource}`
                  : ""}
                {delivery.vendorOrderCompleteConfidence !== undefined
                  ? ` · ${delivery.vendorOrderCompleteConfidence}% confidence`
                  : ""}
              </p>
            ) : condition1ReviewRequired ? (
              <p
                data-testid="readiness-evidence-condition1-status"
                style={{
                  margin: "0 0 8px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-warning-text)",
                }}
              >
                Review required
                {twoSourceConflict
                  ? " — vendor email and physical delivery information conflict"
                  : ""}
              </p>
            ) : (
              <p
                data-testid="readiness-evidence-condition1-status"
                style={{ margin: "0 0 8px", fontSize: 13, color: "var(--admin-text-muted)" }}
              >
                Not confirmed
                {proposals.length > 0 ? " · related email evidence on file" : ""}
              </p>
            )}
            <p
              data-testid="readiness-evidence-condition1-note"
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--admin-text-muted)",
                fontStyle: "italic",
              }}
            >
              Email evidence supports readiness but does not determine readiness.
            </p>
          </div>

          <div data-testid="readiness-evidence-condition2">
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 700,
                color: navy,
                letterSpacing: "0.02em",
              }}
            >
              Physical delivery evidence
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Shop drop-off</span>
                <span data-testid="readiness-evidence-vendor-delivered">
                  {readiness.evidence.physicalDropoffComplete
                    ? "Confirmed"
                    : delivery.vendorPhysicalDropoffConfirmed
                      ? "Vendor marked delivered — quantities not complete"
                      : "Not confirmed"}
                  {delivery.deliveredAt
                    ? ` · ${formatSnapshotDate(delivery.deliveredAt)}`
                    : delivery.vendorPhysicalDropoffConfirmedAt
                      ? ` · ${formatSnapshotDate(delivery.vendorPhysicalDropoffConfirmedAt)}`
                      : ""}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ color: "var(--admin-text-muted)", fontWeight: 600 }}>Staging location</span>
                <span data-testid="readiness-evidence-staging">
                  {details.stagingLocation
                    ? `${details.stagingLocation.code} — ${details.stagingLocation.label}`
                    : "Not assigned"}
                </span>
              </div>
              <div>
                <span
                  style={{
                    color: "var(--admin-text-muted)",
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
                    style={{ color: "var(--admin-text-muted)", fontSize: 12 }}
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

          <div data-testid="readiness-evidence-blockers">
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 700,
                color: navy,
                letterSpacing: "0.02em",
              }}
            >
              Blocking items
            </p>
            {blockReasons.length === 0 &&
            openIssues.length === 0 &&
            !details.stagingLocation &&
            itemConflicts.length === 0 ? (
              <p
                data-testid="readiness-evidence-blockers-none"
                style={{ margin: 0, fontSize: 13, color: "var(--admin-text-muted)" }}
              >
                No blocking items for this delivery.
              </p>
            ) : (
              <ul
                style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--admin-text-secondary)" }}
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
                    Item issue: {item.description}
                    {item.qtyMissing > 0 ? ` · ${item.qtyMissing} missing` : ""}
                    {item.qtyDamaged > 0 ? ` · ${item.qtyDamaged} damaged` : ""}
                    {item.qtyBackordered > 0 ? ` · ${item.qtyBackordered} backordered` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div data-testid="email-evidence-section">
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
                Related email evidence ({emailEvidenceCount})
              </span>
              <span style={{ fontSize: 11, color: "var(--admin-text-muted)" }}>
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
                {emailEvidenceLoading ? (
                  <p
                    data-testid="email-evidence-loading"
                    style={{ margin: 0, fontSize: 13, color: "var(--admin-text-muted)" }}
                  >
                    Loading vendor emails…
                  </p>
                ) : emailEvidenceCount === 0 ? (
                  <p
                    data-testid="email-evidence-empty"
                    style={{ margin: 0, fontSize: 13, color: "var(--admin-text-muted)" }}
                  >
                    No matched email evidence for this delivery.
                  </p>
                ) : (
                  <>
                    {showInvoiceSourceEmail && invoiceSourceEmail ? (
                      <InvoiceSourceEmailCard inbound={invoiceSourceEmail} />
                    ) : null}
                    {vendorEmailEvents.map((event) => (
                      <VendorEmailEventCard key={event.id} event={event} />
                    ))}
                    {proposals.map((row) => (
                      <EmailEvidenceCard key={row.messageId} row={row} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <ReviewVendorEmailModal
        open={reviewVendorEmailOpen}
        details={details}
        navy={navy}
        font={font}
        loading={emailEvidenceLoading}
        invoiceSourceEmail={invoiceSourceEmail}
        showInvoiceSourceEmail={showInvoiceSourceEmail}
        vendorEmailEvents={vendorEmailEvents}
        proposals={proposals}
        onClose={() => onCloseReviewVendorEmail?.()}
      />
      <ReviewVendorEmailModal
        open={fullEmailChainOpen}
        details={details}
        navy={navy}
        font={font}
        loading={emailEvidenceLoading}
        invoiceSourceEmail={invoiceSourceEmail}
        showInvoiceSourceEmail={showInvoiceSourceEmail}
        vendorEmailEvents={vendorEmailEvents}
        proposals={proposals}
        onClose={() => setFullEmailChainOpen(false)}
        title="Full Email Chain"
        testIdPrefix="full-email-chain"
        panelWidth="min(1100px, 96vw)"
        panelMaxHeight="90vh"
      />
    </div>
  );
}
