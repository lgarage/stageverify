import { useMemo } from "react";
import { getProposedEmailUpdates } from "./getProposedEmailUpdates";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const REVIEW_LABEL: Record<string, string> = {
  pending_review: "Needs review",
  auto_processed: "Would auto-process (Phase 6+)",
  approved: "Approved",
  rejected: "Rejected",
};

export function ProposedEmailUpdatesPanel() {
  const proposals = useMemo(() => getProposedEmailUpdates(), []);

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
            {proposals.map((row) => (
              <tr key={row.messageId}>
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
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
