import {
  INVOICE_REJECT_REASON_OPTIONS,
  rejectReasonConfirmEnabled,
  type InvoiceRejectReasonId,
} from "./invoiceRejectReasons";

const RED = "#bf0a30";
const MUTED = "var(--admin-text-muted)";
const CELL_TEXT = "var(--admin-text)";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const HEADER_BTN = {
  backgroundColor: "var(--admin-surface)",
  color: "var(--admin-text-label)",
  border: "1px solid var(--admin-border)",
  borderRadius: 6,
  padding: "8px 14px",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  fontFamily: FONT,
} as const;

export function InvoiceRejectReasonDialog({
  open,
  title = "Why reject this import?",
  helpText = "Pick a known issue and explain why. StageVerify saves a generalized training lesson so future parses improve — not invoice-specific IDs.",
  confirmLabel = "Reject import",
  reasonId,
  detailText,
  loading,
  onReasonIdChange,
  onDetailTextChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  helpText?: string;
  confirmLabel?: string;
  reasonId: InvoiceRejectReasonId | "";
  detailText: string;
  loading?: boolean;
  onReasonIdChange: (id: InvoiceRejectReasonId | "") => void;
  onDetailTextChange: (text: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  const confirmEnabled = rejectReasonConfirmEnabled(reasonId, detailText);

  return (
    <div
      data-testid="invoice-reject-reason-dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10004,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        data-testid="invoice-reject-reason-panel"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderRadius: 10,
          padding: 24,
          width: "100%",
          maxWidth: 480,
          color: CELL_TEXT,
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px", color: "var(--admin-text-label)", fontSize: 18 }}>{title}</h3>
        <p
          data-testid="invoice-reject-reason-help"
          style={{ margin: "0 0 14px", fontSize: 13, color: "var(--admin-text-secondary)", lineHeight: 1.45 }}
        >
          {helpText}
        </p>
        <label
          htmlFor="invoice-reject-reason-select"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--admin-text-label)",
            marginBottom: 6,
          }}
        >
          Known issue
        </label>
        <select
          id="invoice-reject-reason-select"
          data-testid="invoice-reject-reason-select"
          value={reasonId}
          onChange={(e) =>
            onReasonIdChange(e.target.value as InvoiceRejectReasonId | "")
          }
          disabled={loading}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            fontSize: 13,
            fontWeight: 500,
            color: CELL_TEXT,
            backgroundColor: "var(--admin-surface)",
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 14,
            fontFamily: FONT,
          }}
        >
          <option value="">Select a reason…</option>
          {INVOICE_REJECT_REASON_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <label
          htmlFor="invoice-reject-reason-detail"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 700,
            color: "var(--admin-text-label)",
            marginBottom: 6,
          }}
        >
          Why was this rejected? <span style={{ fontWeight: 500, color: MUTED }}>(required)</span>
        </label>
        <textarea
          id="invoice-reject-reason-detail"
          data-testid="invoice-reject-reason-detail"
          value={detailText}
          onChange={(e) => onDetailTextChange(e.target.value)}
          placeholder="Describe why this import should be rejected — e.g. wrong vendor, duplicate PO, credit memo not an invoice…"
          aria-required="true"
          rows={3}
          disabled={loading}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.45,
            color: CELL_TEXT,
            backgroundColor: "var(--admin-surface)",
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            padding: "12px 14px",
            resize: "vertical",
            minHeight: 72,
            fontFamily: FONT,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="invoice-reject-reason-cancel"
            disabled={loading}
            onClick={onCancel}
            style={{ ...HEADER_BTN }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="invoice-reject-reason-confirm"
            disabled={loading || !confirmEnabled}
            onClick={onConfirm}
            style={{
              backgroundColor: RED,
              color: "var(--admin-on-navy)",
              border: "none",
              borderRadius: "var(--admin-control-radius)",
              padding: "8px 14px",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading || !confirmEnabled ? "not-allowed" : "pointer",
              opacity: loading || !confirmEnabled ? 0.55 : 1,
              fontFamily: FONT,
            }}
          >
            {loading ? "Rejecting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
