import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { auth } from "./firebase";
import { signOutWithConfirm } from "./signOutWithConfirm";
import { DispatcherPortalLinks } from "./PortalNavBar";
import { PORTAL_TOPBAR_CLASS } from "./dispatcherPortalLayout";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export type DispatcherPortalTopBarProps = {
  title: string;
  subtitle?: string;
  headerExtra?: ReactNode;
  lastUpdated?: string | null;
  refreshBusy?: boolean;
  refreshDisabled?: boolean;
  gmailSyncMessage?: string | null;
  onRefreshNow?: () => void;
  onNewDelivery?: () => void;
  showNewDelivery?: boolean;
};

export function DispatcherPortalTopBar({
  title,
  subtitle,
  headerExtra,
  lastUpdated,
  refreshBusy = false,
  refreshDisabled = false,
  gmailSyncMessage,
  onRefreshNow,
  onNewDelivery,
  showNewDelivery = true,
}: DispatcherPortalTopBarProps) {
  const navigate = useNavigate();

  const handleNewDelivery = () => {
    if (onNewDelivery) {
      onNewDelivery();
      return;
    }
    navigate("/dispatcher", { state: { openNewDelivery: true } });
  };

  return (
    <div
      className={PORTAL_TOPBAR_CLASS}
      style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e0e3e8",
        height: 52,
        padding: "0 20px",
        boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span style={{ color: NAVY, fontWeight: 700, fontSize: 15 }}>{title}</span>
        {subtitle ? (
          <span style={{ color: "#9ca3af", fontSize: 13 }}>/ {subtitle}</span>
        ) : null}
        {headerExtra}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 min-w-0">
        <DispatcherPortalLinks />
        {showNewDelivery ? (
          <button
            type="button"
            onClick={handleNewDelivery}
            data-testid="dispatcher-new-delivery"
            style={{
              padding: "5px 12px",
              borderRadius: 4,
              border: "none",
              backgroundColor: RED,
              color: "#fff",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: FONT,
              outline: "none",
            }}
          >
            + New Delivery
          </button>
        ) : null}
        {onRefreshNow ? (
          <button
            type="button"
            onClick={() => void onRefreshNow()}
            disabled={refreshBusy || refreshDisabled}
            data-testid="dispatcher-refresh-now"
            style={{
              padding: "5px 12px",
              borderRadius: 4,
              border: `1.5px solid ${NAVY}`,
              backgroundColor: refreshBusy || refreshDisabled ? "#f3f4f6" : "#fff",
              color: refreshBusy || refreshDisabled ? "#9ca3af" : NAVY,
              fontWeight: 700,
              fontSize: 12,
              cursor: refreshBusy || refreshDisabled ? "not-allowed" : "pointer",
              fontFamily: FONT,
              outline: "none",
            }}
          >
            {refreshBusy ? "Syncing…" : "Refresh Now"}
          </button>
        ) : null}
        {gmailSyncMessage ? (
          <span
            data-testid="gmail-sync-message"
            style={{
              fontSize: 12,
              color: gmailSyncMessage.includes("failed") ? "#b91c1c" : "#166534",
              fontWeight: 600,
              maxWidth: 360,
            }}
          >
            {gmailSyncMessage}
          </span>
        ) : null}
        {lastUpdated !== undefined ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Last updated:{" "}
            <span style={{ fontWeight: 600, color: "#374151" }}>
              {lastUpdated ?? "Loading…"}
            </span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => signOutWithConfirm(auth, navigate)}
          style={{
            padding: "5px 12px",
            borderRadius: 4,
            border: `1.5px solid ${NAVY}`,
            backgroundColor: "#fff",
            color: NAVY,
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: FONT,
            outline: "none",
          }}
        >
          Sign Out
        </button>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            backgroundColor: NAVY,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          D
        </div>
      </div>
    </div>
  );
}
