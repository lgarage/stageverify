import { useEffect, useMemo, useRef, useState } from "react";
import { getProposedEmailUpdates } from "./getProposedEmailUpdates";
import {
  filterNeedsReviewEmails,
  getHumanReviewReason,
} from "./emailReviewHelpers";
import { listPendingInboundVendorEmailEvents } from "../firestoreService";
import type { VendorEmailEvent } from "../models";
import type { ProposedEmailUpdate } from "./getProposedEmailUpdates";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function liveEventToProposal(event: VendorEmailEvent): ProposedEmailUpdate {
  return {
    messageId: event.sourceMessageId,
    subject: event.subject,
    senderEmail: event.senderEmail,
    receivedAt: event.receivedAt,
    classification: (event.emailClassification ?? "needs_dispatcher_review") as ProposedEmailUpdate["classification"],
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
    originalBody: event.bodyExcerpt ?? "",
    recipientEmails: event.recipientEmails ?? [],
    threadId: event.threadId,
    proposedOperationalMeaning: event.matchedBy
      ? `Matched via ${event.matchedBy} — dispatcher confirm required`
      : "Unmatched inbound reply",
    affectsCondition1: false,
    condition1ApprovalNote: "",
  };
}

export function NeedsReviewEmailStrip() {
  const [liveEvents, setLiveEvents] = useState<VendorEmailEvent[]>([]);
  const [liveLoaded, setLiveLoaded] = useState(false);

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
  const [openOriginalId, setOpenOriginalId] = useState<string | null>(null);
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

  if (needsReview.length === 0) {
    return (
      <section
        data-testid="needs-review-email-strip"
        style={{
          marginBottom: 24,
          border: "1px solid #dde1e7",
          borderRadius: 8,
          backgroundColor: "#fff",
          boxShadow: "rgba(0,0,0,0.08) 0px 2px 8px 0px",
          padding: "12px 18px",
        }}
      >
        <p
          data-testid="needs-review-email-count"
          style={{ margin: 0, fontSize: 13, color: "#64748b", fontFamily: FONT }}
        >
          Needs Review (0) — no unmatched or ambiguous emails.
        </p>
      </section>
    );
  }

  return (
    <section
      ref={stripRef}
      data-testid="needs-review-email-strip"
      style={{
        marginBottom: 24,
        border: "1px solid #dde1e7",
        borderRadius: 8,
        backgroundColor: "#fff",
        boxShadow: "rgba(0,0,0,0.08) 0px 2px 8px 0px",
        overflow: "hidden",
      }}
    >
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
          {expanded ? "Hide" : "Show"} unmatched · ambiguous · corrections
        </span>
      </button>

      {expanded && (
        <div
          data-testid="needs-review-email-list"
          style={{ padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
            Matched vendor emails appear in the delivery drawer only — not here.
          </p>
          {needsReview.map((row) => {
            const reviewReason = getHumanReviewReason(row);
            const showOriginal = openOriginalId === row.messageId;
            return (
              <article
                key={row.messageId}
                data-testid={`needs-review-email-item-${row.messageId}`}
                style={{
                  border: "1px solid #e0e3e8",
                  borderRadius: 6,
                  padding: "12px",
                  backgroundColor: "#fffef8",
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                    {row.vendorName ?? row.senderEmail}
                  </span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {row.receivedAt.slice(0, 10)}
                  </span>
                </div>
                <p
                  style={{ margin: "0 0 8px", fontSize: 12, color: "#475569" }}
                  title={row.subject}
                >
                  {row.subject}
                  {row.poNumber ? (
                    <span style={{ fontFamily: "monospace", marginLeft: 6 }}>{row.poNumber}</span>
                  ) : null}
                </p>
                <p
                  data-testid={`needs-review-email-reason-${row.messageId}`}
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#b45309",
                  }}
                >
                  Review Required — {reviewReason}
                </p>
                <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748b" }}>
                  {row.classification.replace(/_/g, " ")}
                  {row.matchedDeliveryLabel
                    ? ` · possible match: ${row.matchedDeliveryLabel}`
                    : ""}
                </p>
                <button
                  type="button"
                  data-testid={`needs-review-view-original-${row.messageId}`}
                  onClick={() =>
                    setOpenOriginalId((prev) =>
                      prev === row.messageId ? null : row.messageId,
                    )
                  }
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
                  {showOriginal ? "Hide Original Email" : "View Original Email"}
                </button>
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
          })}
        </div>
      )}
    </section>
  );
}
