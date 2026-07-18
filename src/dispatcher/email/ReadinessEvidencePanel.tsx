import { useEffect, useMemo, useState } from "react";
import type { DeliveryDetails, InboundEmailProcessing, StagingLocation, VendorEmailEvent } from "../models";
import { computeDeliveryDisplayState } from "../deliveryDisplayHelpers";
import {
  filterProposalsForDelivery,
  getProposedEmailUpdates,
} from "./getProposedEmailUpdates";
import { hasVendorOrderCompleteApplyConflict } from "./emailApplyConflicts";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";
import {
  formatEmailReviewPreview,
  getEmailReviewHeadlines,
  getSvInterpretation,
  proposalNeedsDrawerReview,
} from "./emailReviewHelpers";
import { READINESS_BLOCK_LABEL } from "../deliveryDisplayHelpers";
import { listVendorEmailEventsForDelivery, getVendorInvoiceImport, getInboundEmailProcessing } from "../firestoreService";

const BLOCK_LABEL: Record<string, string> = READINESS_BLOCK_LABEL;

const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  vendor_email: "Vendor email",
  physical_checkin: "Physical check-in",
  dispatcher: "Dispatcher confirmation",
  system: "System",
};

type SnapshotTone = "ok" | "neutral" | "attention";

function toneColor(tone: SnapshotTone): string {
  if (tone === "ok") return "#2e7d32";
  if (tone === "attention") return "#b45309";
  return "#64748b";
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
      <span style={{ color: "#6b7280", fontWeight: 600, flexShrink: 0 }}>{label}</span>
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

function EmailEvidenceCard({ row }: { row: ProposedEmailUpdate }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const interpretation = getSvInterpretation(row);
  const needsReview = proposalNeedsDrawerReview(row);
  const headlines = needsReview ? getEmailReviewHeadlines(row) : null;
  const preview = formatEmailReviewPreview(row);
  const isCalmMatch = headlines?.tier === "matched_vendor_reply";

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
        data-testid={`email-evidence-preview-${row.messageId}`}
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "#f8fafc",
          border: "1px solid #e8ecf0",
          borderRadius: 4,
          fontSize: 12,
          color: "#334155",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>From: </span>
          {preview.sender}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Subject: </span>
          {preview.subject}
        </div>
        <div style={{ marginBottom: 8 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Received: </span>
          {preview.receivedLabel}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.45 }}>
          {preview.replyPreview}
        </p>
      </div>

      {headlines ? (
        <>
          <p
            data-testid={`email-evidence-review-${row.messageId}`}
            style={{
              margin: "0 0 4px",
              fontSize: 12,
              fontWeight: 700,
              color: isCalmMatch ? "#0a3161" : "#b45309",
            }}
          >
            {headlines.primary}
          </p>
          <p
            data-testid={`email-evidence-secondary-${row.messageId}`}
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              color: "#64748b",
              lineHeight: 1.4,
            }}
          >
            {headlines.secondary}
          </p>
        </>
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
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
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

function formatEmailEventWhen(event: VendorEmailEvent): string {
  const iso = event.sentAt ?? event.receivedAt ?? event.createdAt;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatInboundEmailWhen(inbound: InboundEmailProcessing): string {
  try {
    return new Date(inbound.receivedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return inbound.receivedAt;
  }
}

function InvoiceSourceEmailCard({ inbound }: { inbound: InboundEmailProcessing }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const attachments =
    inbound.attachmentFilenames?.filter(Boolean).join(", ") ||
    inbound.pdfAttachments?.map((att) => att.filename).filter(Boolean).join(", ") ||
    "Invoice PDF";
  const bodyPreview = inbound.combinedExtractedTextPreview?.trim() ?? "";

  return (
    <div
      data-testid={`email-evidence-invoice-source-${inbound.id}`}
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e0e3e8",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <p
        data-testid={`email-evidence-invoice-source-label-${inbound.id}`}
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "#0a3161",
          letterSpacing: "0.02em",
        }}
      >
        Invoice PDF email (scanned)
      </p>
      <div
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "#f8fafc",
          border: "1px solid #e8ecf0",
          borderRadius: 4,
          fontSize: 12,
          color: "#334155",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>From: </span>
          {inbound.senderEmail || "—"}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Subject: </span>
          {inbound.subject || "—"}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Date: </span>
          {formatInboundEmailWhen(inbound)}
        </div>
        <div style={{ marginBottom: bodyPreview ? 8 : 0 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Attachment: </span>
          {attachments}
        </div>
        {bodyPreview ? (
          <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.45 }}>
            {bodyPreview.length > 220 ? `${bodyPreview.slice(0, 219).trim()}…` : bodyPreview}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        data-testid={`email-evidence-invoice-source-view-${inbound.id}`}
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
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
      </button>

      {showOriginal ? (
        <div
          data-testid={`email-evidence-invoice-source-original-${inbound.id}`}
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
            <strong>From:</strong> {inbound.senderEmail || "—"}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {formatInboundEmailWhen(inbound)}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {inbound.subject || "—"}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>PDF attachment:</strong> {attachments}
          </div>
          {bodyPreview ? (
            <pre
              data-testid={`email-evidence-invoice-source-body-${inbound.id}`}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {bodyPreview}
              {inbound.combinedExtractedTextTruncated ? "\n\n[PDF text truncated for preview]" : ""}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontStyle: "italic" }}>
              Email body was not stored; this delivery was created from a scanned invoice PDF
              attachment.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function VendorEmailEventCard({ event }: { event: VendorEmailEvent }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const isOutbound = event.direction === "outbound";
  const body =
    event.bodyText?.trim() ||
    event.bodyExcerpt?.trim() ||
    event.snippet?.trim() ||
    "";
  const preview =
    body.length > 220 ? `${body.slice(0, 219).trim()}…` : body;
  const recipients = event.recipientEmails?.filter(Boolean).join(", ") || "—";

  return (
    <div
      data-testid={`email-evidence-live-card-${event.id}`}
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e0e3e8",
        borderRadius: 6,
        padding: "12px",
      }}
    >
      <p
        data-testid={`email-evidence-live-direction-${event.id}`}
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 700,
          color: isOutbound ? "#0a3161" : "#2e7d32",
          letterSpacing: "0.02em",
        }}
      >
        {isOutbound ? "Sent by dispatcher" : "Received from vendor"}
      </p>
      <div
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "#f8fafc",
          border: "1px solid #e8ecf0",
          borderRadius: 4,
          fontSize: 12,
          color: "#334155",
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>From: </span>
          {event.senderEmail}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>To: </span>
          {recipients}
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Subject: </span>
          {event.subject}
        </div>
        <div style={{ marginBottom: preview ? 8 : 0 }}>
          <span style={{ color: "#64748b", fontWeight: 600 }}>Date: </span>
          {formatEmailEventWhen(event)}
        </div>
        {preview ? (
          <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.45 }}>
            {preview}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        data-testid={`email-evidence-live-view-${event.id}`}
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
        {showOriginal ? "Hide Original Email" : "Show Original Email"}
      </button>

      {showOriginal ? (
        <div
          data-testid={`email-evidence-live-original-${event.id}`}
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
            <strong>From:</strong> {event.senderEmail}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>To:</strong> {recipients}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Date:</strong> {formatEmailEventWhen(event)}
          </div>
          <div style={{ marginBottom: 8 }}>
            <strong>Subject:</strong> {event.subject}
          </div>
          {body ? (
            <pre
              data-testid={`email-evidence-live-body-${event.id}`}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {body}
            </pre>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontStyle: "italic" }}>
              Message body was not stored for this email.
            </p>
          )}
          {isOutbound && event.bodyExcerpt && !event.bodyText ? (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 11,
                color: "#64748b",
                fontStyle: "italic",
              }}
            >
              Showing stored excerpt from outbound send (full body not archived).
            </p>
          ) : null}
        </div>
      ) : null}
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
}: {
  details: DeliveryDetails;
  stagingLocations: StagingLocation[];
  navy: string;
  font: string;
  onExpandVendorCommunications?: () => void;
  /** Increment to expand details + related email evidence (e.g. from action banner). */
  emailEvidenceExpandSignal?: number;
}) {
  const { delivery, items, materialIssues, purchaseOrder } = details;
  const poNumber = purchaseOrder?.poNumber ?? null;

  const proposals = useMemo(() => {
    const all = getProposedEmailUpdates();
    return filterProposalsForDelivery(all, delivery, poNumber);
  }, [delivery, poNumber]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [emailEvidenceOpen, setEmailEvidenceOpen] = useState(false);
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
  const blockingIssues = openIssues.filter((i) => i.blocking);

  const additionalSpots = (delivery.additionalStagingLocationIds ?? [])
    .map((id) => stagingLocations.find((loc) => loc.id === id))
    .filter((loc): loc is StagingLocation => Boolean(loc));

  const itemsReceivedCount = items.reduce((sum, item) => sum + item.qtyReceived, 0);
  const vendorClaimsDelivered =
    delivery.vendorPhysicalDropoffConfirmed === true ||
    delivery.vendorOrderComplete === true;

  const itemConflicts = items.filter((item) => {
    if (item.qtyDamaged > 0 || item.qtyBackordered > 0) return true;
    if (item.qtyMissing > 0) {
      if (itemsReceivedCount === 0 && !vendorClaimsDelivered) return false;
      return true;
    }
    return false;
  });

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

  const physicalSnapshot = (() => {
    if (readiness.evidence.physicalDropoffComplete) {
      return { label: "Confirmed", tone: "ok" as SnapshotTone };
    }
    if (delivery.vendorPhysicalDropoffConfirmed) {
      return { label: "Vendor Marked Delivered", tone: "attention" as SnapshotTone };
    }
    return { label: "Not Confirmed", tone: "neutral" as SnapshotTone };
  })();

  const stagingSnapshot = (() => {
    if (details.stagingLocation) {
      const loc = details.stagingLocation;
      const locationLabel =
        loc.label && loc.label !== loc.code
          ? `${loc.code} — ${loc.label}`
          : loc.code;
      return {
        label: `Assigned to ${locationLabel}`,
        tone: "ok" as SnapshotTone,
      };
    }
    return { label: "Not Assigned", tone: "neutral" as SnapshotTone };
  })();

  const materialSnapshot = (() => {
    if (openIssues.length > 0) {
      const suffix =
        blockingIssues.length > 0
          ? ` (${blockingIssues.length} blocking)`
          : "";
      return {
        label: `Open Issues${suffix}`,
        tone: "attention" as SnapshotTone,
      };
    }
    const missingItems = itemConflicts.filter((item) => item.qtyMissing > 0);
    if (missingItems.length > 0) {
      return { label: "Items Missing", tone: "attention" as SnapshotTone };
    }
    if (itemConflicts.length > 0) {
      return { label: "Open Issues", tone: "attention" as SnapshotTone };
    }
    return { label: "None", tone: "neutral" as SnapshotTone };
  })();

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
    setDetailsOpen(true);
    setEmailEvidenceOpen(true);
  };

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
            border: "1px solid #0a3161",
            backgroundColor: "#fff",
            color: "#0a3161",
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
              border: "1px solid #cbd5e1",
              backgroundColor: "#fff",
              color: "#334155",
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
            style={{ fontSize: 12, color: "#9ca3af", padding: "6px 0" }}
          >
            No related vendor email chain found yet.
          </span>
        )}
      </div>

      {detailsOpen && (
        <div
          data-testid="readiness-evidence-details"
          style={{
            borderTop: "1px solid #eaecf0",
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
                  color: "#2e7d32",
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
                  color: "#b45309",
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
                style={{ margin: "0 0 8px", fontSize: 13, color: "#64748b" }}
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
                color: "#64748b",
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
                <span style={{ color: "#6b7280", fontWeight: 600 }}>Shop drop-off</span>
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
                <span style={{ color: "#6b7280", fontWeight: 600 }}>Staging location</span>
                <span data-testid="readiness-evidence-staging">
                  {details.stagingLocation
                    ? `${details.stagingLocation.code} — ${details.stagingLocation.label}`
                    : "Not assigned"}
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
                style={{ margin: 0, fontSize: 13, color: "#64748b" }}
              >
                No blocking items for this delivery.
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
                {emailEvidenceLoading ? (
                  <p
                    data-testid="email-evidence-loading"
                    style={{ margin: 0, fontSize: 13, color: "#64748b" }}
                  >
                    Loading vendor emails…
                  </p>
                ) : emailEvidenceCount === 0 ? (
                  <p
                    data-testid="email-evidence-empty"
                    style={{ margin: 0, fontSize: 13, color: "#9ca3af" }}
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
    </div>
  );
}
