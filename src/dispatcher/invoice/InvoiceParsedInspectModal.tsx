import { useState, type CSSProperties } from "react";
import type {
  InvoiceMatchResult,
  VendorInvoiceImportReview,
} from "../models";
import {
  getInvoiceTrainingAdminStatus,
  getVendorTrainingPlaybook,
  INVOICE_TRAINING_LESSON_TOAST,
  saveInvoiceTrainingLesson,
  saveVendorTrainingPlaybook,
} from "../firestoreService";
import { buildExpectedJohnstoneFieldChecklist } from "./invoiceExpectedFieldsChecklist";
import { useVendorInvoicePdfViewer } from "./useVendorInvoicePdfViewer";
import { AutoImportSuggestionPanel } from "./autoImportSuggestionUi";
import { InvoiceDeliveryMatchSection } from "./InvoiceDeliveryMatchSection";
import {
  buildHeaderDisplayRows,
  INVOICE_HEADER_FIELD_LABELS,
  normalizeParsedHeader,
  codPaymentContext,
  matchUnavailableReason,
  shipDateMissingWarning,
  readInvoiceHeaderField,
  formatInvoiceHeaderField,
} from "./invoiceReviewHeaderHelpers";
import { creditReturnAdvisoryLabel, creditReturnSkipLabel, orderIncompleteMessage } from "./creditReturnSkip";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const CELL_TEXT = "#111827";
const MUTED = "#4b5563";

const HEADER_BTN: CSSProperties = {
  backgroundColor: "#fff",
  color: NAVY,
  border: `1px solid ${NAVY}`,
  borderRadius: 6,
  padding: "8px 14px",
  fontWeight: 600,
  fontSize: 13,
  fontFamily: FONT,
  cursor: "pointer",
};

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
  actionLoading = false,
  onApprove,
  onReject,
  onReopen,
  onRelinkToShell,
  onReparse,
  reparseLoading = false,
  reparseMessage = null,
  readOnly = false,
  deliverToSiteConfirmed = false,
  onImportDismissed,
}: {
  importRow: VendorInvoiceImportReview;
  onClose: () => void;
  matchResult?: InvoiceMatchResult | null;
  matchLoading?: boolean;
  actionLoading?: boolean;
  /** Optional generalized correction note for vendor training MD. */
  onApprove?: (correctionNote?: string) => void;
  onReject?: () => void;
  onReopen?: () => void;
  /** Move approved import off a shared/non-shell delivery onto its own shell. */
  onRelinkToShell?: () => void;
  /** Re-run parser on cached PDF text (pending imports only). */
  onReparse?: () => void;
  reparseLoading?: boolean;
  reparseMessage?: string | null;
  /** Drawer inspect — hide review actions and delivery picker. */
  readOnly?: boolean;
  /** Linked delivery confirmed delivered to job site — suppress review-required UI. */
  deliverToSiteConfirmed?: boolean;
  /** Called when Save lesson apply-now dismisses a CREDIT/return import. */
  onImportDismissed?: () => void;
}) {
  const [correctionNote, setCorrectionNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [saveLessonLoading, setSaveLessonLoading] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminPasswordPrompt, setAdminPasswordPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(
    null,
  );
  const [mdEditor, setMdEditor] = useState<{
    vendorKey: string;
    markdown: string;
    password: string;
  } | null>(null);
  const [mdSaveLoading, setMdSaveLoading] = useState(false);
  const { viewPdf, isLoading: pdfLoading, unavailableMessage: pdfUnavailableMessage } =
    useVendorInvoicePdfViewer();

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 4000);
  };

  const openTrainingAdminSettings = () => {
    window.location.hash = "#/settings?focus=invoice-training-admin";
  };

  const handleAdminClick = async () => {
    if (adminBusy || readOnly) return;
    setAdminBusy(true);
    setAdminPasswordError(null);
    try {
      const status = await getInvoiceTrainingAdminStatus();
      if (!status.fullyConfigured) {
        openTrainingAdminSettings();
        return;
      }
      setAdminPassword("");
      setAdminPasswordPrompt(true);
    } catch (err) {
      setAdminPasswordError(
        err instanceof Error ? err.message : "Could not check Admin setup.",
      );
      setAdminPasswordPrompt(true);
    } finally {
      setAdminBusy(false);
    }
  };

  const unlockPlaybook = async () => {
    if (!adminPassword.trim()) {
      setAdminPasswordError("Enter the Admin password.");
      return;
    }
    setAdminBusy(true);
    setAdminPasswordError(null);
    try {
      const playbook = await getVendorTrainingPlaybook({
        password: adminPassword,
        vendorInvoiceImportId: importRow.id,
      });
      setMdEditor({
        vendorKey: playbook.vendorKey,
        markdown: playbook.markdown,
        password: adminPassword,
      });
      setAdminPasswordPrompt(false);
      setAdminPassword("");
    } catch (err) {
      setAdminPasswordError(
        err instanceof Error ? err.message : "Incorrect password or load failed.",
      );
    } finally {
      setAdminBusy(false);
    }
  };

  const savePlaybook = async () => {
    if (!mdEditor) return;
    setMdSaveLoading(true);
    try {
      await saveVendorTrainingPlaybook({
        password: mdEditor.password,
        vendorKey: mdEditor.vendorKey,
        markdown: mdEditor.markdown,
      });
      showToast(INVOICE_TRAINING_LESSON_TOAST);
      setMdEditor(null);
    } catch (err) {
      setAdminPasswordError(
        err instanceof Error ? err.message : "Could not save playbook.",
      );
    } finally {
      setMdSaveLoading(false);
    }
  };

  const handleSaveLesson = async () => {
    const note = correctionNote.trim();
    if (!note || saveLessonLoading) return;
    setSaveLessonLoading(true);
    try {
      const result = await saveInvoiceTrainingLesson({
        vendorInvoiceImportId: importRow.id,
        correctionNote: note,
      });
      if (result.trainingLessonWrote) {
        showToast(
          result.importDismissed
            ? `${INVOICE_TRAINING_LESSON_TOAST} Credit/return import dismissed from queue.`
            : INVOICE_TRAINING_LESSON_TOAST,
        );
        setCorrectionNote("");
        if (result.importDismissed) {
          onImportDismissed?.();
        }
      } else if (result.trainingLessonPendingAdminReview) {
        showToast(
          "This note is pending Admin review — patterns may need a fix before it can be saved.",
        );
      } else {
        showToast(
          result.reason === "empty"
            ? "Enter a training note first."
            : "Lesson was not saved. Try a more general pattern.",
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save lesson failed.");
    } finally {
      setSaveLessonLoading(false);
    }
  };
  const checklist = buildExpectedJohnstoneFieldChecklist(importRow, {
    deliverToSiteConfirmed,
  });
  const headerRows = buildHeaderDisplayRows(importRow.parsedHeader);
  const normalizedHeader = normalizeParsedHeader(importRow.parsedHeader);
  const codContext = codPaymentContext(importRow);
  const parseWarnings = (importRow.parseWarnings ?? []).filter(Boolean);
  const orderNotes = (importRow.orderNotes ?? []).filter(Boolean);
  const parsedLines = importRow.parsedLines ?? [];
  const lineCount = importRow.parsedLineCount ?? parsedLines.length;
  const isPending = importRow.reviewStatus === "pending_review";
  const isRejected = importRow.reviewStatus === "rejected";
  const approveBlocked = importRow.importStatus === "issue";
  const matchUnavailable = matchUnavailableReason(importRow);
  const shipDateWarning = shipDateMissingWarning(importRow);
  const orderIncomplete = orderIncompleteMessage(importRow);
  const creditSkipLabel = creditReturnSkipLabel(importRow.skipReason);
  const creditAdvisoryLabel = creditReturnAdvisoryLabel(importRow);
  const showDeliveryInfo = !readOnly && (isPending || isRejected);
  const showActions =
    !readOnly &&
    ((isPending && (onApprove || onReject)) ||
      (isRejected && (onApprove || onReopen)) ||
      Boolean(onRelinkToShell));
  const showReparse =
    Boolean(onReparse) &&
    (isPending ||
      (isRejected && importRow.skipReason === "credit_return")) &&
    !readOnly;
  const approveDisabled = actionLoading || approveBlocked;
  const invoiceDateLabel = formatInvoiceHeaderField(
    readInvoiceHeaderField(importRow.parsedHeader, "invoiceDate"),
  );

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
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: "#fff",
          borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
          color: CELL_TEXT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          data-testid="invoice-parsed-inspect-sticky-header"
          style={{
            flexShrink: 0,
            padding: "24px 28px 16px",
            borderBottom: "1px solid #e5e7eb",
            backgroundColor: "#fff",
            borderRadius: "12px 12px 0 0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
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
              <p
                data-testid="invoice-parsed-inspect-subtitle"
                style={{ margin: "6px 0 0", fontSize: 13, color: MUTED }}
              >
                {importRow.pageId} · batch {importRow.importBatchId} · invoice date{" "}
                {invoiceDateLabel}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {!readOnly && (
              <button
                type="button"
                data-testid="invoice-parsed-inspect-admin"
                disabled={adminBusy}
                onClick={() => void handleAdminClick()}
                style={{
                  ...HEADER_BTN,
                  cursor: adminBusy ? "not-allowed" : "pointer",
                  opacity: adminBusy ? 0.55 : 1,
                }}
              >
                Admin
              </button>
            )}
            <button
              type="button"
              data-testid="invoice-parsed-inspect-view-original-pdf"
              disabled={pdfLoading(importRow.id) || Boolean(pdfUnavailableMessage(importRow.id))}
              title={pdfUnavailableMessage(importRow.id) ?? undefined}
              onClick={() => void viewPdf(importRow.id)}
              style={{
                ...HEADER_BTN,
                cursor:
                  pdfLoading(importRow.id) || pdfUnavailableMessage(importRow.id)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  pdfLoading(importRow.id) || pdfUnavailableMessage(importRow.id) ? 0.55 : 1,
              }}
            >
              {pdfLoading(importRow.id) ? "Loading PDF…" : "View original PDF"}
            </button>
            {showReparse && (
              <button
                type="button"
                data-testid="invoice-parsed-inspect-reparse"
                disabled={reparseLoading || actionLoading}
                title="Re-run the invoice parser on cached PDF text"
                onClick={onReparse}
                style={{
                  backgroundColor: "#fff",
                  color: NAVY,
                  border: `1px solid ${NAVY}`,
                  borderRadius: 6,
                  padding: "8px 14px",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: reparseLoading || actionLoading ? "not-allowed" : "pointer",
                  opacity: reparseLoading || actionLoading ? 0.55 : 1,
                }}
              >
                {reparseLoading ? "Refreshing…" : "Refresh"}
              </button>
            )}
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
        </div>
          {pdfUnavailableMessage(importRow.id) ? (
            <p
              data-testid="invoice-parsed-inspect-pdf-unavailable"
              style={{
                margin: "12px 0 0",
                fontSize: 12,
                color: "#9a3412",
              }}
            >
              {pdfUnavailableMessage(importRow.id)}
            </p>
          ) : null}
        </div>

        <div
          data-testid="invoice-parsed-inspect-scroll-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 28px 24px",
          }}
        >
        {showDeliveryInfo && (
          <InvoiceDeliveryMatchSection
            importRow={importRow}
            matchResult={matchResult}
            matchLoading={matchLoading}
            matchUnavailable={matchUnavailable}
            shipDateWarning={shipDateWarning}
          />
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
                  color:
                    checklist.approvalEligibleLabel === "Yes"
                      ? "#166534"
                      : checklist.approvalEligibleLabel === "N/A"
                        ? "#6b7280"
                        : "#9a3412",
                  fontWeight: 600,
                }}
              >
                {checklist.approvalEligibleLabel}
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
          {creditAdvisoryLabel && (
            <div
              data-testid="invoice-parsed-inspect-credit-advisory"
              style={{
                marginTop: 12,
                padding: "10px 12px",
                backgroundColor: "#fef2f2",
                border: "2px solid #fca5a5",
                borderRadius: 8,
                color: "#991b1b",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {creditAdvisoryLabel}
            </div>
          )}
          {creditSkipLabel && (
            <div
              data-testid="invoice-parsed-inspect-skip-reason"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                backgroundColor: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 6,
                color: NAVY,
                fontWeight: 700,
              }}
            >
              <strong>Reject reason:</strong> {creditSkipLabel}
            </div>
          )}
          {checklist.parseGapReason && (
            <div
              data-testid="invoice-parsed-inspect-parse-gaps"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                backgroundColor: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                color: MUTED,
                fontSize: 12,
              }}
            >
              <strong>Parse gaps on skipped credit:</strong> {checklist.parseGapReason}
            </div>
          )}
          {!creditSkipLabel && !creditAdvisoryLabel && checklist.blockReason && (
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
          {orderIncomplete && (
            <div
              data-testid="invoice-parsed-inspect-incomplete-order"
              style={{
                marginTop: 12,
                padding: "8px 10px",
                backgroundColor: "#fff7ed",
                border: "1px solid #fed7aa",
                borderRadius: 6,
                color: "#9a3412",
                fontWeight: 600,
              }}
            >
              {orderIncomplete}
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
          {reparseMessage && (
            <div
              data-testid="invoice-parsed-inspect-reparse-message"
              style={{
                marginTop: 10,
                padding: "8px 10px",
                backgroundColor: reparseMessage.startsWith("Refreshed")
                  ? "#ecfdf5"
                  : "#fff7ed",
                border: `1px solid ${reparseMessage.startsWith("Refreshed") ? "#bbf7d0" : "#fed7aa"}`,
                borderRadius: 6,
                color: reparseMessage.startsWith("Refreshed") ? "#166534" : "#9a3412",
                fontSize: 12,
              }}
            >
              {reparseMessage}
            </div>
          )}
          {!checklist.hideAutoImportSuggestion ? (
            <AutoImportSuggestionPanel importRow={importRow} />
          ) : null}
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
        </div>

        {showActions && (
          <div
            data-testid="invoice-parsed-inspect-actions"
            style={{
              flexShrink: 0,
              padding: "16px 28px 18px",
              borderTop: "1px solid #e5e7eb",
              backgroundColor: "#fff",
              borderRadius: "0 0 12px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {(isPending || isRejected) && (
              <div
                data-testid="invoice-parsed-inspect-training-panel"
                style={{
                  padding: "14px 16px",
                  backgroundColor: "#f0f5fa",
                  border: "1px solid #d0dbe8",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      color: NAVY,
                      fontFamily: FONT,
                    }}
                  >
                    Training note
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#6b7280",
                      }}
                    >
                      optional
                    </span>
                  </h3>
                </div>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "#4b5563",
                    fontWeight: 500,
                    fontFamily: FONT,
                  }}
                >
                  Teach the AI what to look for on the next similar invoice and the
                  proper fix. Use patterns only — no invoice numbers, POs, or addresses.
                </p>
                <textarea
                  data-testid="invoice-parsed-inspect-correction-note"
                  value={correctionNote}
                  onChange={(e) => setCorrectionNote(e.target.value)}
                  placeholder="Example: When Ship Via is WILL CALL, set fulfillment to will_call_pickup — not delivery."
                  rows={3}
                  disabled={actionLoading || saveLessonLoading}
                  style={{
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1.45,
                    color: CELL_TEXT,
                    backgroundColor: "#fff",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    padding: "12px 14px",
                    resize: "vertical",
                    minHeight: 72,
                    fontFamily: FONT,
                    outline: "none",
                    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.04)",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = NAVY;
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(10, 49, 97, 0.12)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "#cbd5e1";
                    e.currentTarget.style.boxShadow =
                      "inset 0 1px 2px rgba(15, 23, 42, 0.04)";
                  }}
                />
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {(isPending || isRejected) && (
                <button
                  type="button"
                  data-testid="invoice-parsed-inspect-save-lesson"
                  disabled={
                    actionLoading ||
                    saveLessonLoading ||
                    !correctionNote.trim()
                  }
                  onClick={() => void handleSaveLesson()}
                  style={{
                    backgroundColor: "#fff",
                    color: NAVY,
                    border: `1px solid ${NAVY}`,
                    borderRadius: 6,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor:
                      actionLoading ||
                      saveLessonLoading ||
                      !correctionNote.trim()
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      actionLoading ||
                      saveLessonLoading ||
                      !correctionNote.trim()
                        ? 0.55
                        : 1,
                    fontFamily: FONT,
                  }}
                >
                  {saveLessonLoading ? "Saving…" : "Save lesson"}
                </button>
              )}
              {onReject && isPending && (
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
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                    fontFamily: FONT,
                  }}
                >
                  Reject
                </button>
              )}
              {onReopen && isRejected && (
                <button
                  type="button"
                  data-testid="invoice-parsed-inspect-reopen"
                  disabled={actionLoading}
                  onClick={onReopen}
                  style={{
                    backgroundColor: "#fff",
                    color: NAVY,
                    border: `1px solid ${NAVY}`,
                    borderRadius: 6,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                    fontFamily: FONT,
                  }}
                >
                  Re-open for review
                </button>
              )}
              {onRelinkToShell && (
                <button
                  type="button"
                  data-testid="invoice-parsed-inspect-relink-shell"
                  disabled={actionLoading || approveBlocked}
                  onClick={onRelinkToShell}
                  style={{
                    backgroundColor: NAVY,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: actionLoading || approveBlocked ? "not-allowed" : "pointer",
                    opacity: actionLoading || approveBlocked ? 0.55 : 1,
                    fontFamily: FONT,
                  }}
                >
                  Create separate delivery
                </button>
              )}
              {onApprove && (isPending || isRejected) && (
                <button
                  type="button"
                  data-testid="invoice-parsed-inspect-approve"
                  disabled={approveDisabled}
                  title={approveBlocked ? "Approve blocked for issue imports" : undefined}
                  onClick={() => onApprove(correctionNote.trim() || undefined)}
                  style={{
                    backgroundColor: NAVY,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "10px 22px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: approveDisabled ? "not-allowed" : "pointer",
                    opacity: approveDisabled ? 0.55 : 1,
                    fontFamily: FONT,
                  }}
                >
                  Approve
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div
          data-testid="invoice-training-toast"
          role="status"
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            backgroundColor: NAVY,
            color: "#fff",
            padding: "12px 18px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            fontFamily: FONT,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            maxWidth: "min(520px, 92vw)",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}

      {adminPasswordPrompt && (
        <div
          data-testid="invoice-training-admin-password-dialog"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => {
            if (!adminBusy) setAdminPasswordPrompt(false);
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 10,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              color: CELL_TEXT,
              fontFamily: FONT,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 8px", color: NAVY, fontSize: 18 }}>
              Admin password
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: MUTED }}>
              Enter the invoice training Admin password to view this vendor&apos;s
              playbook.
            </p>
            <input
              type="password"
              data-testid="invoice-training-admin-password-input"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlockPlaybook();
              }}
              autoFocus
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: 14,
                color: CELL_TEXT,
                backgroundColor: "#fff",
                marginBottom: 10,
              }}
            />
            {adminPasswordError && (
              <p
                data-testid="invoice-training-admin-password-error"
                style={{ margin: "0 0 10px", fontSize: 13, color: RED }}
              >
                {adminPasswordError}
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => setAdminPasswordPrompt(false)}
                disabled={adminBusy}
                style={{ ...HEADER_BTN }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="invoice-training-admin-password-submit"
                disabled={adminBusy}
                onClick={() => void unlockPlaybook()}
                style={{
                  backgroundColor: NAVY,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 14px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: adminBusy ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                }}
              >
                {adminBusy ? "Checking…" : "Open playbook"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mdEditor && (
        <div
          data-testid="invoice-training-md-editor"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10002,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 10,
              padding: 20,
              width: "100%",
              maxWidth: 720,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              color: CELL_TEXT,
              fontFamily: FONT,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <h3 style={{ margin: 0, color: NAVY, fontSize: 18 }}>
                Training playbook — {mdEditor.vendorKey}.md
              </h3>
              <button
                type="button"
                onClick={() => setMdEditor(null)}
                style={{ ...HEADER_BTN }}
              >
                Close
              </button>
            </div>
            <textarea
              data-testid="invoice-training-md-textarea"
              value={mdEditor.markdown}
              onChange={(e) =>
                setMdEditor({ ...mdEditor, markdown: e.target.value })
              }
              rows={18}
              style={{
                flex: 1,
                minHeight: 280,
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 12,
                lineHeight: 1.45,
                color: CELL_TEXT,
                backgroundColor: "#fff",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: 12,
                resize: "vertical",
              }}
            />
            {adminPasswordError && (
              <p style={{ margin: 0, fontSize: 13, color: RED }}>
                {adminPasswordError}
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                data-testid="invoice-training-md-save"
                disabled={mdSaveLoading || !mdEditor.markdown.trim()}
                onClick={() => void savePlaybook()}
                style={{
                  backgroundColor: NAVY,
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 18px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor:
                    mdSaveLoading || !mdEditor.markdown.trim()
                      ? "not-allowed"
                      : "pointer",
                  opacity: mdSaveLoading || !mdEditor.markdown.trim() ? 0.55 : 1,
                  fontFamily: FONT,
                }}
              >
                {mdSaveLoading ? "Saving…" : "Save playbook"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
