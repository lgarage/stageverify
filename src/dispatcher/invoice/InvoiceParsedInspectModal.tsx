import type { CSSProperties } from "react";
import type {
  DeliveryListRow,
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import { buildExpectedJohnstoneFieldChecklist } from "./invoiceExpectedFieldsChecklist";
import { InvoiceDeliveryMatchSection } from "./InvoiceDeliveryMatchSection";
import {
  buildHeaderDisplayRows,
  INVOICE_HEADER_FIELD_LABELS,
  normalizeParsedHeader,
  codPaymentContext,
  matchUnavailableReason,
  shipDateMissingWarning,
} from "./invoiceReviewHeaderHelpers";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const CELL_TEXT = "#111827";
const MUTED = "#4b5563";

const TABLE_CELL: CSSProperties = {
  padding: "10px 12px",
  color: CELL_TEXT,
  verticalAlign: "top",
  lineHeight: 1.45,
};

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function dash(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

export function InvoiceParsedInspectModal({
  importRow,
  onClose,
  matchResult = null,
  matchLoading = false,
  selectedDeliveryId = "",
  onSelectDelivery,
  recentDeliveries,
  recentDeliveriesLoading = false,
  actionLoading = false,
  onApprove,
  onReject,
  highlightApprove = false,
}: {
  importRow: VendorInvoiceImportReview;
  onClose: () => void;
  matchResult?: InvoiceMatchResult | null;
  matchLoading?: boolean;
  selectedDeliveryId?: string;
  onSelectDelivery?: (deliveryId: string) => void;
  recentDeliveries?: DeliveryListRow[];
  recentDeliveriesLoading?: boolean;
  actionLoading?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  highlightApprove?: boolean;
}) {
  const checklist = buildExpectedJohnstoneFieldChecklist(importRow);
  const headerRows = buildHeaderDisplayRows(importRow.parsedHeader);
  const normalizedHeader = normalizeParsedHeader(importRow.parsedHeader);
  const codContext = codPaymentContext(importRow);
  const parseWarnings = (importRow.parseWarnings ?? []).filter(Boolean);
  const orderNotes = (importRow.orderNotes ?? []).filter(Boolean);
  const parsedLines = importRow.parsedLines ?? [];
  const lineCount = importRow.parsedLineCount ?? parsedLines.length;
  const isPending = importRow.reviewStatus === "pending_review";
  const approveBlocked = importRow.importStatus === "issue";
  const matchUnavailable = matchUnavailableReason(importRow);
  const shipDateWarning = shipDateMissingWarning(importRow);
  const showActions = isPending && (onApprove || onReject);
  const approveDisabled = actionLoading || approveBlocked || !selectedDeliveryId.trim();

  return (
    <div
      data-testid="invoice-parsed-inspect-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
        fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <div
        data-testid="invoice-parsed-inspect-panel"
        style={{
          width: "100%",
          maxWidth: 960,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "24px 28px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          color: CELL_TEXT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                color: NAVY,
              }}
            >
              Parsed import data
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: MUTED }}>
              {importRow.pageId} · batch {importRow.importBatchId}
            </p>
          </div>
          <button
            type="button"
            data-testid="invoice-parsed-inspect-close"
            onClick={onClose}
            style={{
              backgroundColor: "#fff",
              color: NAVY,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "8px 14px",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {isPending && onSelectDelivery && (
          <InvoiceDeliveryMatchSection
            importRow={importRow}
            matchResult={matchResult}
            matchLoading={matchLoading}
            matchUnavailable={matchUnavailable}
            shipDateWarning={shipDateWarning}
            selectedDeliveryId={selectedDeliveryId}
            onSelectDelivery={onSelectDelivery}
            recentDeliveries={recentDeliveries}
            recentDeliveriesLoading={recentDeliveriesLoading}
          />
        )}

        {highlightApprove && isPending && !selectedDeliveryId.trim() && (
          <p
            data-testid="invoice-parsed-inspect-approve-prompt"
            style={{
              margin: "0 0 16px",
              padding: "10px 12px",
              backgroundColor: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 6,
              fontSize: 13,
              color: "#9a3412",
            }}
          >
            Select or enter a delivery ID above, then approve.
          </p>
        )}

        <div
          data-testid="invoice-parsed-inspect-summary"
          style={{
            marginBottom: 20,
            padding: "14px 16px",
            backgroundColor: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 12px" }}>
            Review summary
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Document type</div>
              <div data-testid="invoice-parsed-inspect-doc-type">{checklist.documentType}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Import status</div>
              <div>{checklist.importStatus}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Review status</div>
              <div>{checklist.reviewStatus}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Approval eligible</div>
              <div
                data-testid="invoice-parsed-inspect-approval"
                style={{
                  color: checklist.approvalEligible ? "#166534" : "#9a3412",
                  fontWeight: 600,
                }}
              >
                {checklist.approvalEligible ? "Yes" : "No"}
              </div>
            </div>
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Line count</div>
              <div data-testid="invoice-parsed-inspect-line-count">{lineCount}</div>
            </div>
            <div>
              <div style={{ color: MUTED, fontWeight: 600 }}>Gmail message</div>
              <div style={{ wordBreak: "break-all" }}>{importRow.gmailMessageId}</div>
            </div>
            {codContext && (
              <div>
                <div style={{ color: MUTED, fontWeight: 600 }}>Payment terms</div>
                <div
                  data-testid="invoice-parsed-inspect-cod"
                  style={{ color: "#92400e", fontWeight: 700 }}
                >
                  {codContext.chipLabel}
                  {codContext.paymentTermsRaw && codContext.codOnly
                    ? ` (${codContext.paymentTermsRaw})`
                    : ""}
                </div>
              </div>
            )}
          </div>
          {checklist.blockReason && (
            <div
              data-testid="invoice-parsed-inspect-block-reason"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                backgroundColor: "#fff7ed",
                border: "1px solid #fed7aa",
                borderRadius: 6,
                color: "#9a3412",
              }}
            >
              <strong>Block reason:</strong> {checklist.blockReason}
            </div>
          )}
          {checklist.zeroLinesNote && (
            <div
              data-testid="invoice-parsed-inspect-zero-lines"
              style={{ marginTop: 10, color: "#b45309", fontSize: 12 }}
            >
              {checklist.zeroLinesNote}
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
          Parsed header
        </h3>
        {headerRows.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, marginBottom: 20 }}>
            No parsed header fields on this import — check parse warnings or raw payload below.
          </p>
        ) : (
          <div
            data-testid="invoice-parsed-inspect-header"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 20,
              fontSize: 13,
            }}
          >
            {headerRows.map((row) => (
              <div key={row.key}>
                <div style={{ color: MUTED, fontWeight: 600 }}>{row.label}</div>
                <div style={{ color: NAVY, fontWeight: row.key === "customerPoOrReference" ? 600 : 500 }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {parseWarnings.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
              Parse warnings
            </h3>
            <ul
              data-testid="invoice-parsed-inspect-warnings"
              style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 13, color: "#9a3412" }}
            >
              {parseWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </>
        )}

        {orderNotes.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
              Order notes
            </h3>
            <ul
              data-testid="invoice-parsed-inspect-order-notes"
              style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 13, color: CELL_TEXT }}
            >
              {orderNotes.map((note) => (
                <li key={note} style={{ marginBottom: 4 }}>
                  {note}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
          Parsed lines ({parsedLines.length})
        </h3>
        <div
          data-testid="invoice-parsed-inspect-lines"
          style={{ overflowX: "auto", marginBottom: 20 }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#f1f5f9", textAlign: "left" }}>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>LN</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY, minWidth: 88 }}>Product</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY, minWidth: 100 }}>Mfg / model</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY, minWidth: 220 }}>Description</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>Ord</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>Ship</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>B/O</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>UOM</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>Extension</th>
                <th style={{ ...TABLE_CELL, fontWeight: 700, color: NAVY }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {parsedLines.map((line) => (
                <tr
                  key={line.lineNumber}
                  data-testid={`invoice-parsed-inspect-line-${line.lineNumber}`}
                  style={{ borderTop: "1px solid #d1d5db" }}
                >
                  <td style={TABLE_CELL}>{line.lineNumber}</td>
                  <td style={{ ...TABLE_CELL, fontWeight: 700 }}>{dash(line.vendorProductNumber)}</td>
                  <td style={{ ...TABLE_CELL, fontSize: 12 }}>{dash(line.manufacturerOrModelNumber)}</td>
                  <td
                    style={{
                      ...TABLE_CELL,
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                      maxWidth: 360,
                    }}
                  >
                    {dash(line.description)}
                  </td>
                  <td style={TABLE_CELL}>{dash(line.quantityOrdered)}</td>
                  <td style={TABLE_CELL}>{dash(line.quantityShipped)}</td>
                  <td style={TABLE_CELL}>{dash(line.quantityBackordered)}</td>
                  <td style={TABLE_CELL}>{dash(line.unitOfMeasure)}</td>
                  <td style={TABLE_CELL}>{dash(line.lineExtension)}</td>
                  <td style={{ ...TABLE_CELL, fontSize: 12, color: MUTED }}>{dash(line.lineType)}</td>
                </tr>
              ))}
              {parsedLines.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...TABLE_CELL, color: MUTED, textAlign: "center" }}>
                    No parsed lines stored on this import.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              color: RED,
              marginBottom: 10,
            }}
          >
            Raw parsed payload (JSON)
          </summary>
          <pre
            data-testid="invoice-parsed-inspect-raw-json"
            style={{
              margin: 0,
              padding: 12,
              backgroundColor: "#f8fafc",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              fontSize: 11,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: CELL_TEXT,
            }}
          >
            {formatJson({
              parsedHeader: normalizedHeader,
              parsedLines,
              parseWarnings: importRow.parseWarnings,
              orderNotes: importRow.orderNotes,
              parsedLineCount: importRow.parsedLineCount,
              importStatus: importRow.importStatus,
              pageId: importRow.pageId,
              fieldLabels: INVOICE_HEADER_FIELD_LABELS,
            })}
          </pre>
        </details>

        {showActions && (
          <div
            data-testid="invoice-parsed-inspect-actions"
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {onReject && (
              <button
                type="button"
                data-testid="invoice-parsed-inspect-reject"
                disabled={actionLoading}
                onClick={onReject}
                style={{
                  backgroundColor: "#fff",
                  color: RED,
                  border: `1px solid ${RED}`,
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: actionLoading ? "not-allowed" : "pointer",
                  opacity: actionLoading ? 0.6 : 1,
                }}
              >
                Reject
              </button>
            )}
            {onApprove && (
              <button
                type="button"
                data-testid="invoice-parsed-inspect-approve"
                disabled={approveDisabled}
                title={
                  approveBlocked
                    ? "Approve blocked for issue imports"
                    : !selectedDeliveryId.trim()
                      ? "Select or enter a delivery ID first"
                      : undefined
                }
                onClick={onApprove}
                style={{
                  backgroundColor: NAVY,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: approveDisabled ? "not-allowed" : "pointer",
                  opacity: approveDisabled ? 0.55 : 1,
                }}
              >
                Approve
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
