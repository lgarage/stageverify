import { useEffect } from "react";
import { NAVY } from "../../theme/brandColors";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const CATCH_ALL_STATUS_NOTE =
  "Regular vendor deliveries can be matched to expected jobs and checked in to their staging spots. For carrier packages (UPS, FedEx, Speedy, etc.) with no matching job, use Catch-all check-in to flag them as unidentifiable.";

type Props = {
  open: boolean;
  pendingCount: number;
  onClose: () => void;
};

/**
 * View-only catch-all status panel on Staging Map — delivery drawer chrome, no CTAs.
 */
export function CatchAllStatusDrawer({ open, pendingCount, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="catch-all-status-drawer"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        backgroundColor: "rgba(10,15,30,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          maxWidth: 480,
          backgroundColor: "#fff",
          borderLeft: "1px solid #e0e3e8",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.18)",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          fontFamily: FONT,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 20px",
            borderBottom: "1px solid #e0e3e8",
            position: "sticky",
            top: 0,
            backgroundColor: "#fff",
            zIndex: 10,
            boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
          }}
        >
          <div>
            <h2
              data-testid="catch-all-status-drawer-title"
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: NAVY,
              }}
            >
              Catch All Deliveries status
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "#6b7280",
                marginTop: 2,
              }}
            >
              Click outside or press Esc to close
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close catch-all status"
            style={{
              padding: "5px 12px",
              border: "1px solid #ccd0d7",
              borderRadius: 4,
              backgroundColor: "#f9fafb",
              color: "#333",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              outline: "none",
              fontFamily: FONT,
            }}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: "20px", flex: 1 }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 13,
              fontWeight: 600,
              color: "#333",
            }}
          >
            Pending catch-all check-ins
          </p>
          <p
            data-testid="catch-all-status-drawer-count"
            style={{
              margin: "0 0 20px",
              fontSize: 28,
              fontWeight: 800,
              color: NAVY,
              lineHeight: 1.1,
            }}
          >
            {pendingCount}
          </p>
          <p
            data-testid="catch-all-status-drawer-note"
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
              color: "#333",
            }}
          >
            {CATCH_ALL_STATUS_NOTE}
          </p>
        </div>
      </div>
    </div>
  );
}
