const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const BTN_SECONDARY = {
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

export function ManualItemDeliveredPlannedConfirmDialog({
  open,
  spotCode,
  loading,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  spotCode: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      data-testid="manual-item-delivered-planned-confirm-dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10010,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        data-testid="manual-item-delivered-planned-confirm-panel"
        role="dialog"
        aria-labelledby="manual-item-delivered-planned-title"
        style={{
          backgroundColor: "var(--admin-surface)",
          borderRadius: 10,
          padding: 24,
          width: "100%",
          maxWidth: 400,
          color: "var(--admin-text-data)",
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="manual-item-delivered-planned-title"
          style={{ margin: "0 0 12px", color: "var(--admin-text-label)", fontSize: 18 }}
        >
          Confirm delivery location
        </h3>
        <p
          data-testid="manual-item-delivered-planned-prompt"
          style={{
            margin: "0 0 18px",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--admin-text-data)",
            lineHeight: 1.45,
          }}
        >
          Was this delivered to {spotCode}?
        </p>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 13,
            color: "var(--admin-text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Confirm marks the line Delivered and records {spotCode} as the physical staging
          spot. Cancel leaves the line Not Delivered.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            data-testid="manual-item-delivered-planned-cancel"
            disabled={loading}
            onClick={onCancel}
            style={{ ...BTN_SECONDARY, opacity: loading ? 0.55 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="manual-item-delivered-planned-confirm"
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
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
