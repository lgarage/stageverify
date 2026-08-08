import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { auth } from "./firebase";
import { signOutWithConfirm } from "./signOutWithConfirm";
import { VendorCommunicationsTopBarEntry } from "./dispatcher/VendorCommunicationsTopBarEntry";
import { CatchAllDeliveryTopBarEntry } from "./dispatcher/CatchAllDeliveryTopBarEntry";
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
      data-testid="dispatcher-portal-topbar"
      className={PORTAL_TOPBAR_CLASS}
      style={{
        backgroundColor: "var(--admin-surface)",
        borderBottom: "1px solid var(--admin-border)",
        minHeight: 64,
        padding: "0 24px",
        boxShadow: "var(--admin-shadow-card)",
        display: "grid",
        gridTemplateColumns:
          "minmax(120px, 220px) max-content minmax(0, 1fr) max-content",
        alignItems: "center",
        columnGap: 12,
        minWidth: 0,
        overflow: "visible",
      }}
    >
      <div
        data-testid="dispatcher-topbar-breadcrumb"
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--admin-link)", fontWeight: 700, fontSize: 15 }}>{title}</span>
        {subtitle ? (
          <span style={{ color: "var(--admin-text-muted)", fontSize: 13 }}> / {subtitle}</span>
        ) : null}
      </div>
      <div
        data-testid="dispatcher-topbar-middle"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <VendorCommunicationsTopBarEntry />
        {headerExtra}
      </div>
      <div aria-hidden="true" style={{ minWidth: 0 }} />
      <div
        data-testid="dispatcher-topbar-actions"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          flexShrink: 0,
          flexWrap: "nowrap",
        }}
      >
        <CatchAllDeliveryTopBarEntry />
        {showNewDelivery ? (
          <button
            type="button"
            className="admin-btn"
            onClick={handleNewDelivery}
            data-testid="dispatcher-new-delivery"
            style={{
              padding: "0 16px",
              borderRadius: "var(--admin-control-radius)",
              border: "none",
              backgroundColor: RED,
              color: "#ffffff",
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
            className="admin-btn"
            onClick={() => void onRefreshNow()}
            disabled={refreshBusy || refreshDisabled}
            data-testid="dispatcher-refresh-now"
            style={{
              padding: "0 16px",
              borderRadius: "var(--admin-control-radius)",
              border: `1.5px solid ${NAVY}`,
              backgroundColor: refreshBusy || refreshDisabled ? "var(--admin-surface-2)" : "var(--admin-surface)",
              color: refreshBusy || refreshDisabled ? "var(--admin-text-muted)" : "var(--admin-link)",
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
              color: gmailSyncMessage.includes("failed") ? "var(--admin-danger-text)" : "var(--admin-success-text)",
              fontWeight: 600,
              maxWidth: 360,
            }}
          >
            {gmailSyncMessage}
          </span>
        ) : null}
        {lastUpdated !== undefined ? (
          <div
            data-testid="dispatcher-topbar-last-updated"
            style={{
              fontSize: 12,
              color: "var(--admin-text-muted)",
              whiteSpace: "nowrap",
              flexShrink: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 180,
            }}
          >
            Last updated:{" "}
            <span style={{ fontWeight: 600, color: "var(--admin-text)" }}>
              {lastUpdated ?? "Loading…"}
            </span>
          </div>
        ) : null}
        <button
          type="button"
          className="admin-btn"
          data-testid="dispatcher-sign-out"
          onClick={() => signOutWithConfirm(auth, navigate)}
          style={{
            padding: "0 16px",
            borderRadius: "var(--admin-control-radius)",
            border: `1.5px solid ${NAVY}`,
            backgroundColor: "var(--admin-surface)",
            color: "var(--admin-link)",
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
            backgroundColor: "var(--admin-navy)",
            color: "var(--admin-on-navy)",
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
