import { Fragment, useMemo, useState } from "react";
import { getProposedEmailUpdates } from "./getProposedEmailUpdates";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const REVIEW_LABEL: Record<string, string> = {
  pending_review: "Needs review",
  auto_processed: "Would auto-process (Phase 6+)",
  approved: "Approved",
  rejected: "Rejected",
};

type FilterKey = "all" | "needs_review" | "low_confidence";

export function ProposedEmailUpdatesPanel() {
  const proposals = useMemo(() => getProposedEmailUpdates(), []);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const needsReviewCount = proposals.filter(
    (p) => p.reviewStatus === "pending_review",
  ).length;
  const lowConfidenceCount = proposals.filter((p) => p.confidenceScore < 85).length;

  const filtered = proposals.filter((row) => {
    if (filter === "needs_review") return row.reviewStatus === "pending_review";
    if (filter === "low_confidence") return row.confidenceScore < 85;
    return true;
  });

  return (
    <section
      data-testid="proposed-email-updates-panel"
      style={{
        marginBottom: 24,
        border: "1px solid #dde1e7",
        borderRadius: 8,
        backgroundColor: "#fff",
        boxShadow: "rgba(0,0,0,0.08) 0px 2px 8px 0px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #eaecf0",
          backgroundColor: "#f8fafc",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: NAVY,
            fontFamily: FONT,
          }}
        >
          Proposed Email Updates
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
          Offline fixture preview — read-only. AI may propose; dispatcher approves before
          any operational change (Phase 5 prototype).
        </p>
        <div
          data-testid="proposed-email-summary"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 10,
            fontSize: 12,
            color: "#475569",
          }}
        >
          <span>
            <strong>{proposals.length}</strong> proposals
          </span>
          <span>
            <strong>{needsReviewCount}</strong> need review
          </span>
          <span>
            <strong>{lowConfidenceCount}</strong> low confidence
          </span>
        </div>
        <div
          style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
          data-testid="proposed-email-filters"
        >
          {(
            [
              ["all", "All"],
              ["needs_review", "Needs review"],
              ["low_confidence", "Low confidence"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`proposed-email-filter-${key}`}
              onClick={() => setFilter(key)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${filter === key ? NAVY : "#cbd5e1"}`,
                backgroundColor: filter === key ? "#e8f0fa" : "#fff",
                color: filter === key ? NAVY : "#64748b",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9", textAlign: "left" }}>
              {["Received", "Vendor", "Subject", "Type", "PO", "Confidence", "Status"].map(
                (col) => (
                  <th
                    key={col}
                    style={{
                      padding: "10px 12px",
                      fontWeight: 700,
                      color: "#475569",
                      fontSize: 11,
                      letterSpacing: "0.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <Fragment key={row.messageId}>
                <tr
                  onClick={() =>
                    setExpandedId((prev) =>
                      prev === row.messageId ? null : row.messageId,
                    )
                  }
                  style={{ cursor: "pointer" }}
                  data-testid={`proposed-email-row-${row.messageId}`}
                >
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      whiteSpace: "nowrap",
                      color: "#64748b",
                      fontSize: 12,
                    }}
                  >
                    {row.receivedAt.slice(0, 10)}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      color: "#334155",
                    }}
                  >
                    {row.vendorName ?? "—"}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      maxWidth: 280,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.subject}
                  >
                    {row.subject}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {row.classification}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {row.poNumber ?? "—"}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      fontWeight: 600,
                      color: row.confidenceScore >= 85 ? "#2e7d32" : "#c62828",
                    }}
                  >
                    {row.confidenceScore}%
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #eaecf0",
                      fontSize: 12,
                    }}
                  >
                    {REVIEW_LABEL[row.reviewStatus] ?? row.reviewStatus}
                  </td>
                </tr>
                {expandedId === row.messageId && (
                  <tr key={`${row.messageId}-detail`}>
                    <td
                      colSpan={7}
                      style={{
                        padding: "10px 14px 14px",
                        borderBottom: "1px solid #eaecf0",
                        backgroundColor: "#f8fafc",
                        fontSize: 12,
                        color: "#475569",
                      }}
                      data-testid={`proposed-email-detail-${row.messageId}`}
                    >
                      <strong>Preview:</strong> {row.subject}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
