import { useEffect, useMemo, useRef, useState } from "react";
import { getProposedEmailUpdates } from "./getProposedEmailUpdates";
import {
  filterNeedsReviewEmails,
  formatEmailReviewPreview,
  getEmailReviewHeadlines,
} from "./emailReviewHelpers";
import {
  listPendingInboundVendorEmailEvents,
  listDismissedInboundVendorEmailEvents,
  dismissVendorEmailEvent,
  reopenVendorEmailEvent,
} from "../firestoreService";
import type { VendorEmailEvent } from "../models";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function liveEventToProposal(event: VendorEmailEvent): ProposedEmailUpdate {
  const originalBody = event.bodyText ?? event.bodyExcerpt ?? "";
  return {
    eventId: event.id,
    messageId: event.sourceMessageId,
    subject: event.subject,
    senderEmail: event.senderEmail,
    receivedAt: event.receivedAt,
    classification: (event.emailClassification ??
      "needs_dispatcher_review") as ProposedEmailUpdate["classification"],
    poNumber: event.proposedPoNumber ?? null,
    vendorName: null,
    confidenceScore: event.confidenceScore ?? 0,
    confidenceReason: event.confidenceReason ?? event.applyConflictReason ?? "pending_review",
    reviewStatus: "pending_review",
    duplicate: false,
    matchedJobNumber: event.proposedJobNumber ?? null,
    matchedPoLabel: event.proposedPoNumber ?? null,
    matchedOrderLabel: event.proposedOrderNumber ?? null,
    matchedDeliveryLabel: event.deliveryOrderId ?? null,
    matchedDeliveryOrderId: event.deliveryOrderId ?? null,
    itemLines: [],
    bodyExcerpt: event.bodyExcerpt ?? "",
    originalBody,
    recipientEmails: event.recipientEmails ?? [],
    threadId: event.threadId,
    proposedOperationalMeaning:
      event.matchedBy && event.matchedBy !== "none"
        ? "Matched vendor reply — dispatcher confirm required"
        : "Unmatched inbound reply",
    affectsCondition1: false,
    condition1ApprovalNote: "",
    matchedBy: event.matchedBy,
    humanReviewRequired: event.humanReviewRequired,
    applyConflictReason: event.applyConflictReason,
  };
}

export function NeedsReviewEmailStrip() {
  const [liveEvents, setLiveEvents] = useState<VendorEmailEvent[]>([]);
  const [dismissedEvents, setDismissedEvents] = useState<VendorEmailEvent[]>([]);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const [dismissedLoaded, setDismissedLoaded] = useState(false);

  const reloadDismissed = () => {
    void listDismissedInboundVendorEmailEvents()
      .then((rows) => {
        setDismissedEvents(rows);
        setDismissedLoaded(true);
      })
      .catch(() => {
        setDismissedLoaded(true);
      });
  };

  useEffect(() => {
    let cancelled = false;
    void listPendingInboundVendorEmailEvents()
      .then((rows) => {
        if (!cancelled) {
          setLiveEvents(rows);
          setLiveLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLiveLoaded(true);
      });
    reloadDismissed();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsReview = useMemo(() => {
    if (liveEvents.length > 0) {
      return liveEvents.map(liveEventToProposal);
    }
    if (!liveLoaded) return [];
    const all = getProposedEmailUpdates();
    return filterNeedsReviewEmails(all);
  }, [liveEvents, liveLoaded]);

  const [expanded, setExpanded] = useState(false);
  const [dismissedExpanded, setDismissedExpanded] = useState(false);
  const [openOriginalId, setOpenOriginalId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [undoLoadingId, setUndoLoadingId] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const stripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (stripRef.current?.contains(target)) return;
      setExpanded(false);
      setOpenOriginalId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        setOpenOriginalId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  const handleDismiss = async (eventId: string, sourceMessageId: string) => {
    setDismissError(null);
    setDismissingId(eventId);
    const dismissedEvent = liveEvents.find((e) => e.id === eventId);
    try {
      await dismissVendorEmailEvent(eventId);
      setLiveEvents((prev) => prev.filter((e) => e.id !== eventId));
      setOpenOriginalId((prev) => (prev === sourceMessageId ? null : prev));
      if (dismissedEvent) {
        setDismissedEvents((prev) => {
          if (prev.some((e) => e.id === dismissedEvent.id)) return prev;
          return [dismissedEvent, ...prev];
        });
      } else {
        reloadDismissed();
      }
    } catch (err) {
      setDismissError(err instanceof Error ? err.message : "Dismiss failed.");
    } finally {
      setDismissingId(null);
    }
  };

  const handleUndoDismiss = async (event: VendorEmailEvent) => {
    setUndoError(null);
    setUndoLoadingId(event.id);
    try {
      await reopenVendorEmailEvent(event.id);
      setDismissedEvents((prev) => prev.filter((e) => e.id !== event.id));
      setLiveEvents((prev) => {
        if (prev.some((e) => e.id === event.id)) return prev;
        return [...prev, event].sort((a, b) =>
          (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""),
        );
      });
      setExpanded(true);
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : "Undo failed.");
    } finally {
      setUndoLoadingId(null);
    }
  };

  const dismissedCount = dismissedEvents.length;

  return (
    <section
      ref={needsReview.length > 0 ? stripRef : undefined}
      data-testid="needs-review-email-strip"
      style={{
        border: "1px solid #dde1e7",
        borderRadius: 8,
        backgroundColor: "#fff",
        boxShadow: "rgba(0,0,0,0.08) 0px 2px 8px 0px",
        overflow: "hidden",
      }}
    >
      {needsReview.length > 0 ? (
        <>
          <button
            type="button"
            data-testid="needs-review-email-toggle"
            onClick={() => setExpanded((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 18px",
              border: "none",
              backgroundColor: "#f8fafc",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: FONT,
            }}
          >
            <span
              data-testid="needs-review-email-count"
              style={{ fontSize: 15, fontWeight: 700, color: NAVY }}
            >
              Needs Review ({needsReview.length})
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {expanded ? "Hide" : "Show"} vendor replies · unmatched · ambiguous
            </span>
          </button>

          {expanded && (
            <div
              data-testid="needs-review-email-list"
              style={{
                padding: "12px 18px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {dismissError && (
                <p
                  data-testid="needs-review-email-dismiss-error"
                  style={{
                    margin: 0,
                    padding: "8px 10px",
                    borderRadius: 4,
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    fontSize: 12,
                  }}
                >
                  {dismissError}
                </p>
              )}
              {needsReview.map((row) => (
                <NeedsReviewEmailCard
                  key={row.messageId}
                  row={row}
                  openOriginalId={openOriginalId}
                  dismissingId={dismissingId}
                  onToggleOriginal={(messageId) =>
                    setOpenOriginalId((prev) => (prev === messageId ? null : messageId))
                  }
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: "12px 18px" }}>
          <p
            data-testid="needs-review-email-count"
            style={{ margin: 0, fontSize: 13, color: "#64748b", fontFamily: FONT }}
          >
            Needs Review (0) — no unmatched or ambiguous emails.
          </p>
        </div>
      )}

      <DismissedEmailsFooter
        dismissedCount={dismissedCount}
        dismissedLoaded={dismissedLoaded}
        dismissedExpanded={dismissedExpanded}
        dismissedEvents={dismissedEvents}
        undoLoadingId={undoLoadingId}
        undoError={undoError}
        onToggle={() => setDismissedExpanded((v) => !v)}
        onUndo={(event) => void handleUndoDismiss(event)}
      />
    </section>
  );
}

function NeedsReviewEmailCard({
  row,
  openOriginalId,
  dismissingId,
  onToggleOriginal,
  onDismiss,
}: {
  row: ProposedEmailUpdate;
  openOriginalId: string | null;
  dismissingId: string | null;
  onToggleOriginal: (messageId: string) => void;
  onDismiss: (eventId: string, sourceMessageId: string) => void;
}) {
  const headlines = getEmailReviewHeadlines(row);
  const preview = formatEmailReviewPreview(row);
  const showOriginal = openOriginalId === row.messageId;
  const isCalmMatch = headlines.tier === "matched_vendor_reply";

  return (
    <article
      data-testid={`needs-review-email-item-${row.messageId}`}
      data-review-tier={headlines.tier}
      style={{
        border: "1px solid #e0e3e8",
        borderRadius: 6,
        padding: "12px",
        backgroundColor: isCalmMatch ? "#f8fafc" : "#fffef8",
      }}
    >
      <div
        data-testid={`needs-review-email-preview-${row.messageId}`}
        style={{
          marginBottom: 10,
          padding: "10px 12px",
          backgroundColor: "#fff",
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
        <p
          data-testid={`needs-review-email-excerpt-${row.messageId}`}
          style={{
            margin: 0,
            fontSize: 13,
            color: "#1e293b",
            lineHeight: 1.45,
            fontStyle: preview.replyPreview ? "normal" : "italic",
          }}
        >
          {preview.replyPreview}
        </p>
      </div>

      <p
        data-testid={`needs-review-email-reason-${row.messageId}`}
        style={{
          margin: "0 0 4px",
          fontSize: 13,
          fontWeight: 700,
          color: isCalmMatch ? NAVY : "#b45309",
        }}
      >
        {headlines.primary}
      </p>
      <p
        data-testid={`needs-review-email-secondary-${row.messageId}`}
        style={{
          margin: "0 0 10px",
          fontSize: 12,
          color: "#64748b",
          lineHeight: 1.4,
        }}
      >
        {headlines.secondary}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          data-testid={`needs-review-view-original-${row.messageId}`}
          onClick={() => onToggleOriginal(row.messageId)}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: `1px solid ${NAVY}`,
            backgroundColor: "#fff",
            color: NAVY,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {showOriginal ? "Hide Original Email" : "Show Original Email"}
        </button>
        {row.eventId && (
          <button
            type="button"
            data-testid={`needs-review-email-dismiss-${row.messageId}`}
            disabled={dismissingId === row.eventId}
            onClick={() => onDismiss(row.eventId!, row.messageId)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${RED}`,
              backgroundColor: dismissingId === row.eventId ? "#f8fafc" : "#fff",
              color: RED,
              fontSize: 11,
              fontWeight: 700,
              cursor: dismissingId === row.eventId ? "wait" : "pointer",
              opacity: dismissingId === row.eventId ? 0.7 : 1,
            }}
          >
            {dismissingId === row.eventId ? "Dismissing…" : "Dismiss"}
          </button>
        )}
      </div>
      {showOriginal && (
        <div
          data-testid={`needs-review-original-${row.messageId}`}
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
    </article>
  );
}

function DismissedEmailsFooter({
  dismissedCount,
  dismissedLoaded,
  dismissedExpanded,
  dismissedEvents,
  undoLoadingId,
  undoError,
  onToggle,
  onUndo,
}: {
  dismissedCount: number;
  dismissedLoaded: boolean;
  dismissedExpanded: boolean;
  dismissedEvents: VendorEmailEvent[];
  undoLoadingId: string | null;
  undoError: string | null;
  onToggle: () => void;
  onUndo: (event: VendorEmailEvent) => void;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid #e0e3e8",
        backgroundColor: "#fafbfc",
      }}
    >
      <button
        type="button"
        data-testid="needs-review-dismissed-toggle"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 18px",
          border: "none",
          background: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: FONT,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
          Dismissed emails
          {dismissedLoaded ? ` (${dismissedCount})` : ""}
        </span>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          {dismissedExpanded ? "Hide" : "Show"}
        </span>
      </button>

      {dismissedExpanded && (
        <div
          data-testid="needs-review-dismissed-list"
          style={{
            padding: "0 18px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {!dismissedLoaded && (
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Loading…</p>
          )}
          {dismissedLoaded && dismissedEvents.length === 0 && (
            <p
              data-testid="needs-review-dismissed-empty"
              style={{ margin: 0, fontSize: 12, color: "#64748b" }}
            >
              No dismissed emails.
            </p>
          )}
          {undoError && (
            <p
              data-testid="needs-review-email-undo-error"
              style={{
                margin: 0,
                padding: "8px 10px",
                borderRadius: 4,
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: 12,
              }}
            >
              {undoError}
            </p>
          )}
          {dismissedEvents.map((event) => {
            const subject = event.subject?.trim() || "Email";
            const received = event.receivedAt
              ? new Date(event.receivedAt).toLocaleString()
              : "—";
            const loading = undoLoadingId === event.id;
            return (
              <div
                key={event.id}
                data-testid={`needs-review-dismissed-item-${event.sourceMessageId}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  backgroundColor: "#fff",
                }}
              >
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{subject}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {event.senderEmail} · {received}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`needs-review-email-undo-${event.sourceMessageId}`}
                  disabled={loading || undoLoadingId !== null}
                  onClick={() => onUndo(event)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 4,
                    border: `1px solid ${NAVY}`,
                    backgroundColor: "#fff",
                    color: NAVY,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: loading || undoLoadingId !== null ? "wait" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? "Restoring…" : "Undo"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
