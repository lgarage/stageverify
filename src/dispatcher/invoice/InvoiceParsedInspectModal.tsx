import type { VendorInvoiceImportReview } from "../models";
import {
  buildExpectedJohnstoneFieldChecklist,
  statusColor,
  statusLabel,
  type ExpectedFieldRow,
} from "./invoiceExpectedFieldsChecklist";
import {
  buildHeaderDisplayRows,
  INVOICE_HEADER_FIELD_LABELS,
  normalizeParsedHeader,
} from "./invoiceReviewHeaderHelpers";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ExpectedFieldsTable({
  title,
  rows,
}: {
  title: string;
  rows: ExpectedFieldRow[];
}) {
  return (
    <>
      <h4 style={{ fontSize: 13, fontWeight: 700, color: NAVY, margin: "16px 0 8px" }}>
        {title}
      </h4>
      <div style={{ overflowX: "auto", marginBottom: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: "#f8fafc", textAlign: "left" }}>
              <th style={{ padding: "8px 10px" }}>Field</th>
              <th style={{ padding: "8px 10px" }}>Expected for invoice?</th>
              <th style={{ padding: "8px 10px" }}>Actual value</th>
              <th style={{ padding: "8px 10px" }}>Status</th>
              <th style={{ padding: "8px 10px" }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={{ padding: "8px 10px", fontWeight: 600 }}>{row.field}</td>
                <td style={{ padding: "8px 10px" }}>{row.expectedForInvoice}</td>
                <td style={{ padding: "8px 10px" }}>{row.actualValue}</td>
                <td
                  style={{
                    padding: "8px 10px",
                    fontWeight: 600,
                    color: statusColor(row.status),
                  }}
                >
                  {statusLabel(row.status)}
                </td>
                <td style={{ padding: "8px 10px", color: "#6b7280" }}>{row.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function InvoiceParsedInspectModal({
  importRow,
  onClose,
}: {
  importRow: VendorInvoiceImportReview;
  onClose: () => void;
}) {
  const checklist = buildExpectedJohnstoneFieldChecklist(importRow);
  const headerRows = buildHeaderDisplayRows(importRow.parsedHeader);
  const normalizedHeader = normalizeParsedHeader(importRow.parsedHeader);
  const parseWarnings = (importRow.parseWarnings ?? []).filter(Boolean);
  const orderNotes = (importRow.orderNotes ?? []).filter(Boolean);
  const parsedLines = importRow.parsedLines ?? [];
  const lineCount = importRow.parsedLineCount ?? parsedLines.length;

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
          maxWidth: 920,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "24px 28px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
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
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b7280" }}>
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
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Document type</div>
              <div data-testid="invoice-parsed-inspect-doc-type">{checklist.documentType}</div>
            </div>
            <div>
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Import status</div>
              <div>{checklist.importStatus}</div>
            </div>
            <div>
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Review status</div>
              <div>{checklist.reviewStatus}</div>
            </div>
            <div>
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Approval eligible</div>
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
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Line count</div>
              <div>{lineCount}</div>
            </div>
            <div>
              <div style={{ color: "#6b7280", fontWeight: 600 }}>Gmail message</div>
              <div style={{ wordBreak: "break-all" }}>{importRow.gmailMessageId}</div>
            </div>
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
          Expected vs actual fields
        </h3>
        <div data-testid="invoice-parsed-inspect-expected-fields">
          <ExpectedFieldsTable title="Header fields" rows={checklist.rows} />
          <ExpectedFieldsTable title="Line items" rows={checklist.lineRows} />
        </div>

        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
          Parsed header
        </h3>
        {headerRows.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
            No parsed header fields on this import — check parse warnings or raw payload below.
          </p>
        ) : (
          <div
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
                <div style={{ color: "#6b7280", fontWeight: 600 }}>{row.label}</div>
                <div style={{ color: NAVY, fontWeight: row.key === "customerPoOrReference" ? 600 : 400 }}>
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
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 13 }}>
              {orderNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>
          Parsed lines ({parsedLines.length})
        </h3>
        <div style={{ overflowX: "auto", marginBottom: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ backgroundColor: "#f8fafc", textAlign: "left" }}>
                <th style={{ padding: "8px 10px" }}>LN</th>
                <th style={{ padding: "8px 10px" }}>Product</th>
                <th style={{ padding: "8px 10px" }}>Description</th>
                <th style={{ padding: "8px 10px" }}>Ord</th>
                <th style={{ padding: "8px 10px" }}>Ship</th>
                <th style={{ padding: "8px 10px" }}>B/O</th>
                <th style={{ padding: "8px 10px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {parsedLines.map((line) => (
                <tr key={line.lineNumber} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "8px 10px" }}>{line.lineNumber}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                    {line.vendorProductNumber}
                  </td>
                  <td style={{ padding: "8px 10px" }}>{line.description}</td>
                  <td style={{ padding: "8px 10px" }}>{line.quantityOrdered}</td>
                  <td style={{ padding: "8px 10px" }}>{line.quantityShipped}</td>
                  <td style={{ padding: "8px 10px" }}>{line.quantityBackordered}</td>
                  <td style={{ padding: "8px 10px" }}>{line.lineType}</td>
                </tr>
              ))}
              {parsedLines.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "#6b7280" }}>
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
      </div>
    </div>
  );
}
