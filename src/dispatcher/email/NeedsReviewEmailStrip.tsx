import { useMemo, useState } from "react";
import { getProposedEmailUpdates } from "./getProposedEmailUpdates";
import {
  filterNeedsReviewEmails,
  getHumanReviewReason,
} from "./emailReviewHelpers";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function NeedsReviewEmailStrip() {
  const needsReview = useMemo(() => {
    const all = getProposedEmailUpdates();
    return filterNeedsReviewEmails(all);
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [openOriginalId, setOpenOriginalId] = useState<string | null>(null);

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
