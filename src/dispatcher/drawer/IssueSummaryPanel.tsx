import { useMemo, useState } from "react";
import type { DeliveryDetails } from "../models";
import {
  buildIssueSummaryPanelData,
  isDeliverToSiteFullyReceived,
  ITEM_ISSUE_STATUS_COLOR,
  type ItemIssueDisplayStatus,
} from "../deliveryDisplayHelpers";
import { DeliverToSitePanel } from "./DeliverToSitePanel";

/** Option A — editable receipt states written via updateItemQty. */
export type OrderSummaryEditableStatus = "Not Delivered" | "Delivered";

export function IssueSummaryPanel({
  details,
  navy,
  font,
  loading = false,
  onSetDeliverToSiteConfirmed,
  onUpdateItemReceiptStatus,
}: {
  details: DeliveryDetails;
  navy: string;
  font: string;
  loading?: boolean;
  onSetDeliverToSiteConfirmed?: (confirmed: boolean) => Promise<void>;
  onUpdateItemReceiptStatus?: (
    itemId: string,
    status: OrderSummaryEditableStatus,
  ) => Promise<void>;
}) {
  const [receivedExpanded, setReceivedExpanded] = useState(false);

  const summary = useMemo(
    () =>
      buildIssueSummaryPanelData(
        details.delivery,
        details.items,
        details.materialIssues,
      ),
    [details.delivery, details.items, details.materialIssues],
  );

  const siteConfirmed = isDeliverToSiteFullyReceived(details.delivery);
  const canEditReceipt =
    Boolean(onUpdateItemReceiptStatus) && !siteConfirmed && !loading;

  const statusLines = [
    `Delivery Status: ${summary.deliveryStatusLabel}`,
    `${summary.itemsReceivedCount} of ${summary.itemsTotalCount} Items Received`,
  ];

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
        Order Summary
      </h3>

      <div
        style={{
          backgroundColor: "#f8fafc",
          border: "1px solid #e0e3e8",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <DeliverToSitePanel
          details={details}
          navy={navy}
          font={font}
          loading={loading}
          onSetConfirmed={
            onSetDeliverToSiteConfirmed ??
            (async () => {
              /* no-op when handler not wired */
            })
          }
        />
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
        </ul>

        {siteConfirmed && onUpdateItemReceiptStatus && (
          <p
            data-testid="order-summary-site-confirmed-hint"
            style={{
              margin: "0 0 12px",
              fontSize: 12,
              color: "#b45309",
              lineHeight: 1.4,
            }}
          >
            Line status is locked while site delivery is confirmed. Clear site
            confirmation above to edit received qty.
          </p>
        )}

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
              <IssueTableRow
                key={row.itemId}
                row={row}
                font={font}
                canEdit={canEditReceipt && row.status === "Not Delivered"}
                onChangeStatus={
                  onUpdateItemReceiptStatus
                    ? (status) => onUpdateItemReceiptStatus(row.itemId, status)
                    : undefined
                }
              />
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
                  gap: 6,
                }}
              >
                {summary.receivedItems.map((item) => (
                  <li
                    key={item.itemId}
                    style={{
                      fontSize: 13,
                      color: "#2e7d32",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>
                      <span aria-hidden>✓ </span>({item.qty}) {item.description}
                    </span>
                    {canEditReceipt && onUpdateItemReceiptStatus ? (
                      <select
                        data-testid={`issue-summary-status-${item.itemId}`}
                        aria-label={`Status for ${item.description}`}
                        value="Delivered"
                        disabled={loading}
                        onChange={(e) => {
                          const next = e.target.value as OrderSummaryEditableStatus;
                          if (next === "Delivered") return;
                          void onUpdateItemReceiptStatus(item.itemId, next);
                        }}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: font,
                          color: ITEM_ISSUE_STATUS_COLOR.Delivered,
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          padding: "2px 6px",
                          backgroundColor: "#fff",
                          maxWidth: 130,
                        }}
                      >
                        <option value="Delivered">Delivered</option>
                        <option value="Not Delivered">Not Delivered</option>
                      </select>
                    ) : null}
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
  font,
  canEdit,
  onChangeStatus,
}: {
  row: {
    itemId: string;
    description: string;
    qty: number;
    status: ItemIssueDisplayStatus;
  };
  font: string;
  canEdit: boolean;
  onChangeStatus?: (status: OrderSummaryEditableStatus) => Promise<void>;
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
      {canEdit && onChangeStatus && row.status === "Not Delivered" ? (
        <select
          data-testid={`issue-summary-status-${row.itemId}`}
          aria-label={`Status for ${row.description}`}
          value="Not Delivered"
          onChange={(e) => {
            const next = e.target.value as OrderSummaryEditableStatus;
            if (next === "Not Delivered") return;
            void onChangeStatus(next);
          }}
          style={{
            textAlign: "right",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: font,
            color,
            border: "1px solid #d1d5db",
            borderRadius: 4,
            padding: "2px 4px",
            backgroundColor: "#fff",
            width: "100%",
          }}
        >
          <option value="Not Delivered">Not Delivered</option>
          <option value="Delivered">Delivered</option>
        </select>
      ) : (
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
      )}
    </div>
  );
}
