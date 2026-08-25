import { lazy, Suspense } from "react";
import { PortalSidebar } from "./PortalSidebar";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import { PortalShell } from "./PortalShell";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";

const VendorsManagementPanel = lazy(() =>
  import("./VendorsManagementPanel").then((m) => ({
    default: m.VendorsManagementPanel,
  })),
);

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function VendorsPage() {
  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    handleRefreshNow,
    vendors,
    refreshGeneration,
  } = useDispatcherPortal();

  return (
    <PortalShell style={{ fontFamily: FONT }}>
      <PortalSidebar />

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
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
          style={{ backgroundColor: "var(--admin-bg)" }}
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
                  color: "var(--admin-accent-soft)",
                  margin: 0,
                  lineHeight: "1.2",
                }}
              >
                Vendors
              </h1>
              <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4 }}>
                Add and edit vendor contacts used on deliveries and check-in.
              </p>
            </div>

            <Suspense
              fallback={
                <p style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>
                  Loading vendors…
                </p>
              }
            >
              <VendorsManagementPanel
                syncedVendors={vendors}
                refreshGeneration={refreshGeneration}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
