import { useMemo, useState } from "react";
import type { DeliveryDetails } from "../models";
import {
  buildIssueSummaryPanelData,
  ITEM_ISSUE_STATUS_COLOR,
  type ItemIssueDisplayStatus,
} from "../deliveryDisplayHelpers";

export function IssueSummaryPanel({
  details,
  navy,
  font,
}: {
  details: DeliveryDetails;
  navy: string;
  font: string;
}) {
  const [receivedExpanded, setReceivedExpanded] = useState(false);
  const [openIssuesExpanded, setOpenIssuesExpanded] = useState(false);

  const summary = useMemo(
    () =>
      buildIssueSummaryPanelData(
        details.delivery,
        details.items,
        details.materialIssues,
      ),
    [details.delivery, details.items, details.materialIssues],
  );

  const statusLines = [
    `Delivery Status: ${summary.deliveryStatusLabel}`,
    `${summary.itemsReceivedCount} of ${summary.itemsTotalCount} Items Received`,
  ];

  const openIssuesLabel = `${summary.openIssuesCount} Open Issue${
    summary.openIssuesCount === 1 ? "" : "s"
  }`;

  return (
    <section data-testid="issue-summary-panel" style={{ fontFamily: font }}>
      <h3
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          fontWeight: 700,
          color: "#9ca3af",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 16,
            height: 2,
            backgroundColor: navy,
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        Issue Summary
      </h3>

      <div
        style={{
          backgroundColor: "#f8fafc",
          border: "1px solid #e0e3e8",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <ul
          data-testid="issue-summary-lines"
          style={{
            margin: "0 0 12px",
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {statusLines.map((line) => (
            <li
              key={line}
              style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#334155" }}
            >
              {line}
            </li>
          ))}
          {summary.openIssuesCount > 0 && (
            <li style={{ margin: 0 }}>
              <button
                type="button"
                data-testid="issue-summary-open-issues-toggle"
                onClick={() => setOpenIssuesExpanded((v) => !v)}
                aria-expanded={openIssuesExpanded}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: 0,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#334155",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 10, color: "#64748b" }}>
                  {openIssuesExpanded ? "▼" : "▶"}
                </span>
                {openIssuesLabel}
              </button>
              {openIssuesExpanded && summary.openIssueExplanations.length > 0 && (
                <ul
                  data-testid="issue-summary-open-issues-list"
                  style={{
                    margin: "8px 0 0 22px",
                    paddingLeft: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {summary.openIssueExplanations.map((issue) => (
                    <li
                      key={issue.id}
                      data-testid={`issue-summary-explanation-${issue.id}`}
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#475569",
                        lineHeight: 1.45,
                      }}
                    >
                      {issue.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
          {summary.openIssuesCount === 0 && (
            <li
              data-testid="issue-summary-no-open-issues"
              style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#2e7d32" }}
            >
              No open issues
            </li>
          )}
        </ul>

        {summary.issueRows.length > 0 && (
          <div
            data-testid="issue-summary-table"
            style={{
              border: "1px solid #e0e3e8",
              borderRadius: 6,
              overflow: "hidden",
              backgroundColor: "#fff",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 48px 120px",
                gap: 8,
                padding: "8px 12px",
                backgroundColor: "#f1f5f9",
                borderBottom: "1px solid #e0e3e8",
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <span>Item</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Status</span>
            </div>
            {summary.issueRows.map((row) => (
              <IssueTableRow key={row.itemId} row={row} />
            ))}
          </div>
        )}

        {summary.receivedItems.length > 0 && (
          <div data-testid="issue-summary-received-items">
            <button
              type="button"
              data-testid="issue-summary-received-toggle"
              onClick={() => setReceivedExpanded((v) => !v)}
              aria-expanded={receivedExpanded}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "8px 0 0",
                border: "none",
                borderTop: summary.issueRows.length > 0 ? "1px solid #e0e3e8" : undefined,
                background: "none",
                cursor: "pointer",
                fontFamily: font,
                fontSize: 13,
                fontWeight: 700,
                color: navy,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 10, color: "#64748b" }}>
                {receivedExpanded ? "▼" : "▶"}
              </span>
              {summary.receivedItems.length} Item
              {summary.receivedItems.length === 1 ? "" : "s"} Received
            </button>
            {receivedExpanded && (
              <ul
                data-testid="issue-summary-received-list"
                style={{
                  margin: "8px 0 0",
                  paddingLeft: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {summary.receivedItems.map((item) => (
                  <li
                    key={item.itemId}
                    style={{
                      fontSize: 13,
                      color: "#2e7d32",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                  >
                    <span aria-hidden>✓</span>
                    <span>
                      ({item.qty}) {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function IssueTableRow({
  row,
}: {
  row: {
    itemId: string;
    description: string;
    qty: number;
    status: ItemIssueDisplayStatus;
  };
}) {
  const color = ITEM_ISSUE_STATUS_COLOR[row.status];
  return (
    <div
      data-testid={`issue-summary-row-${row.itemId}`}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 48px 120px",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid #f1f5f9",
        fontSize: 13,
        alignItems: "center",
      }}
    >
      <span style={{ color: "#334155" }}>{row.description}</span>
      <span
        data-testid={`issue-summary-qty-${row.itemId}`}
        style={{ textAlign: "center", fontWeight: 600, color: "#475569" }}
      >
        {row.qty}
      </span>
      <span
        data-testid={`issue-summary-status-${row.itemId}`}
        style={{
          textAlign: "right",
          fontWeight: 700,
          fontSize: 12,
          color,
        }}
      >
        {row.status}
      </span>
    </div>
  );
}
