import { useMemo, useState } from "react";
import type { DeliveryDetails } from "../models";
import {
  buildIssueSummaryPanelData,
  isDeliverToSiteFullyReceived,
  ITEM_ISSUE_STATUS_COLOR,
  type ItemIssueDisplayStatus,
} from "../deliveryDisplayHelpers";
import { useVendorInvoicePdfViewer } from "../invoice/useVendorInvoicePdfViewer";
import { DeliverToSitePanel } from "./DeliverToSitePanel";

const VIEW_PDF_BTN = {
  backgroundColor: "var(--admin-surface)",
  color: "var(--admin-accent-soft)",
  border: "1px solid var(--admin-accent)",
  borderRadius: 6,
  padding: "6px 12px",
  fontWeight: 600,
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
} as const;

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
  const [receivedExpanded, setReceivedExpanded] = useState(false);
  const vendorInvoiceImportId = details.delivery.vendorInvoiceImportId?.trim() ?? "";
  const { viewPdf, isLoading: pdfLoading, unavailableMessage: pdfUnavailableMessage } =
    useVendorInvoicePdfViewer();
  const pdfUnavailable = vendorInvoiceImportId
    ? pdfUnavailableMessage(vendorInvoiceImportId)
    : null;
  const pdfBusy = vendorInvoiceImportId
    ? pdfLoading(vendorInvoiceImportId)
    : false;

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
          color: "var(--admin-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
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
        {vendorInvoiceImportId ? (
          <button
            type="button"
            data-testid="delivery-drawer-view-original-pdf"
            disabled={pdfBusy || Boolean(pdfUnavailable)}
            title={
              pdfUnavailable ??
              "Open the vendor invoice PDF in a new browser tab"
            }
            onClick={() => void viewPdf(vendorInvoiceImportId)}
            style={{
              ...VIEW_PDF_BTN,
              fontFamily: font,
              cursor:
                pdfBusy || pdfUnavailable ? "not-allowed" : "pointer",
              opacity: pdfBusy || pdfUnavailable ? 0.55 : 1,
              flexShrink: 0,
            }}
          >
            {pdfBusy ? "Loading PDF…" : "View original PDF"}
          </button>
        ) : (
          <button
            type="button"
            data-testid="delivery-drawer-view-original-pdf"
            disabled
            title="No linked invoice import — PDF unavailable"
            style={{
              ...VIEW_PDF_BTN,
              fontFamily: font,
              cursor: "not-allowed",
              opacity: 0.45,
              flexShrink: 0,
            }}
          >
            View original PDF
          </button>
        )}
      </h3>
      {pdfUnavailable ? (
        <p
          data-testid="delivery-drawer-pdf-unavailable"
          style={{
            margin: "0 0 10px",
            fontSize: 12,
            color: "var(--admin-warning-text)",
            lineHeight: 1.4,
          }}
        >
          {pdfUnavailable}
        </p>
      ) : null}

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

        {summary.issueRows.length > 0 && (
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
                borderTop: summary.issueRows.length > 0 ? "1px solid var(--admin-border)" : undefined,
                background: "none",
                cursor: "pointer",
                fontFamily: font,
                fontSize: 13,
                fontWeight: 700,
                color: "var(--admin-accent-soft)",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 10, color: "var(--admin-text-muted)" }}>
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
                      color: "var(--admin-success-text)",
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
                          border: "1px solid var(--admin-border)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          backgroundColor: "var(--admin-surface)",
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
