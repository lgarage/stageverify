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

export function InvoiceFulfillmentOverrideConfirmDialog({
  open,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      data-testid="invoice-fulfillment-override-confirm-dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10005,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        data-testid="invoice-fulfillment-override-confirm-panel"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderRadius: 10,
          padding: 24,
          width: "100%",
          maxWidth: 480,
          color: "var(--admin-text-data)",
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px", color: "var(--admin-text-label)", fontSize: 18 }}>
          Assign staging location?
        </h3>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--admin-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Assigning a staging location changes this order from Will-Call to Vendor Drop-Off — the
          order will be delivered to the shop instead of picked up at the vendor.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="invoice-fulfillment-override-cancel"
            disabled={loading}
            onClick={onCancel}
            style={{ ...HEADER_BTN }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="invoice-fulfillment-override-confirm"
            disabled={loading}
            onClick={onConfirm}
            style={{
              backgroundColor: "#0a3161",
              color: "var(--admin-on-navy, #fff)",
              border: "none",
              borderRadius: 6,
              padding: "8px 14px",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.55 : 1,
              fontFamily: FONT,
            }}
          >
            {loading ? "Applying…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
