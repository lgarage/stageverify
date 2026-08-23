import { useMemo } from "react";
import type { DeliveryDetails } from "../models";
import {
  buildIssueSummaryPanelData,
  buildUnifiedOrderSummaryRows,
  isDeliverToSiteFullyReceived,
  ITEM_ISSUE_STATUS_COLOR,
  type ItemIssueDisplayStatus,
} from "../deliveryDisplayHelpers";
import { DeliverToSitePanel } from "./DeliverToSitePanel";

const BACKORDERED_BADGE = {
  display: "inline-block",
  backgroundColor: "var(--admin-warning-bg)",
  border: "2px solid var(--admin-warning-border)",
  borderRadius: 999,
  padding: "2px 8px",
  fontWeight: 800,
  fontSize: 11,
  color: "var(--admin-warning-text)",
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
};

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
  const summary = useMemo(
    () =>
      buildIssueSummaryPanelData(
        details.delivery,
        details.items,
        details.materialIssues,
      ),
    [details.delivery, details.items, details.materialIssues],
  );
  const unifiedRows = useMemo(
    () => buildUnifiedOrderSummaryRows(details.delivery, details.items),
    [details.delivery, details.items],
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
          color: "var(--admin-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        </span>
      </h3>

      <div
        style={{
          backgroundColor: "var(--admin-surface-2)",
          border: "1px solid var(--admin-border)",
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
              style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--admin-text-data)" }}
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
              color: "var(--admin-warning-text)",
              lineHeight: 1.4,
            }}
          >
            Line status is locked while site delivery is confirmed. Clear site
            confirmation above to edit received qty.
          </p>
        )}

        {unifiedRows.length > 0 && (
          <div
            data-testid="issue-summary-table"
            style={{
              border: "1px solid var(--admin-border)",
              borderRadius: 6,
              overflow: "hidden",
              backgroundColor: "var(--admin-surface)",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 48px 120px",
                gap: 8,
                padding: "8px 12px",
                backgroundColor: "var(--admin-surface-2)",
                borderBottom: "1px solid var(--admin-border)",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--admin-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <span>Item</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Status</span>
            </div>
            {unifiedRows.map((row) => (
              <IssueTableRow
                key={row.itemId}
                row={row}
                font={font}
                canEdit={
                  canEditReceipt &&
                  (row.status === "Not Delivered" || row.status === "Delivered")
                }
                onChangeStatus={
                  onUpdateItemReceiptStatus
                    ? (status) => onUpdateItemReceiptStatus(row.itemId, status)
                    : undefined
                }
              />
            ))}
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
        borderBottom: "1px solid var(--admin-border)",
        fontSize: 13,
        alignItems: "center",
      }}
    >
      <span style={{ color: "var(--admin-text-data)" }}>{row.description}</span>
      <span
        data-testid={`issue-summary-qty-${row.itemId}`}
        style={{ textAlign: "center", fontWeight: 600, color: "var(--admin-text-data)" }}
      >
        {row.qty}
      </span>
      {canEdit &&
      onChangeStatus &&
      (row.status === "Not Delivered" || row.status === "Delivered") ? (
        <select
          data-testid={`issue-summary-status-${row.itemId}`}
          aria-label={`Status for ${row.description}`}
          value={row.status}
          onChange={(e) => {
            const next = e.target.value as OrderSummaryEditableStatus;
            if (next === row.status) return;
            void onChangeStatus(next);
          }}
          style={{
            textAlign: "right",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: font,
            color,
            border: "1px solid var(--admin-border)",
            borderRadius: 4,
            padding: "2px 4px",
            backgroundColor: "var(--admin-surface)",
            width: "100%",
          }}
        >
          <option value="Not Delivered">Not Delivered</option>
          <option value="Delivered">Delivered</option>
        </select>
      ) : row.status === "Backordered" ? (
        <span
          data-testid="issue-summary-backordered-badge"
          style={BACKORDERED_BADGE}
        >
          BACKORDERED
        </span>
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
