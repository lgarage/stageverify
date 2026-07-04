import { PortalSidebar } from "./PortalSidebar";
import { VendorsManagementPanel } from "./VendorsManagementPanel";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherGmailRefresh } from "./dispatcher/useDispatcherGmailRefresh";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function VendorsPage() {
  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    handleRefreshNow,
  } = useDispatcherGmailRefresh();

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar />

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "#f0f2f5" }}
      >
        <DispatcherPortalTopBar
          title="Vendors"
          subtitle="Vendor Management"
          lastUpdated={lastUpdated}
          refreshBusy={refreshBusy}
          gmailSyncMessage={gmailSyncMessage}
          onRefreshNow={handleRefreshNow}
        />

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "#f0f2f5" }}
        >
          <div
            style={{
              padding: "30px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              width: "100%",
              maxWidth: 1440,
              margin: "0 auto",
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: NAVY,
                  margin: 0,
                  lineHeight: "1.2",
                }}
              >
                Vendors
              </h1>
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                Add and edit vendor contacts used on deliveries and check-in.
              </p>
            </div>

            <VendorsManagementPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
