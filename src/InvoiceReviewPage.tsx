import { useCallback, useRef } from "react";
import { PortalSidebar } from "./PortalSidebar";
import { InvoiceReviewPanel } from "./dispatcher/invoice/InvoiceReviewPanel";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherGmailRefresh } from "./dispatcher/useDispatcherGmailRefresh";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function InvoiceReviewPage() {
  const loadQueueRef = useRef<() => Promise<void>>(async () => {});

  const handleRegisterLoadQueue = useCallback((loadQueue: () => Promise<void>) => {
    loadQueueRef.current = loadQueue;
  }, []);

  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    handleRefreshNow,
  } = useDispatcherGmailRefresh({
    onAfterRefresh: async () => {
      await loadQueueRef.current();
    },
  });

  return (
    <div
      data-testid="invoice-review-page"
      style={{ fontFamily: FONT }}
      className={PORTAL_SHELL_CLASS}
    >
      <PortalSidebar />

      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "#f0f2f5" }}
      >
        <DispatcherPortalTopBar
          title="Invoice Review"
          subtitle="Johnstone import queue"
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
              width: "100%",
              maxWidth: 1440,
              margin: "0 auto",
            }}
          >
            <div style={{ marginBottom: 20 }}>
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: NAVY,
                  margin: 0,
                  lineHeight: "1.2",
                }}
              >
                Invoice import review
              </h1>
              <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                Review parsed Johnstone invoices from inbound email. Approve applies
                expected items only — no shop receipt or readiness changes.
              </p>
            </div>

            <InvoiceReviewPanel onRegisterLoadQueue={handleRegisterLoadQueue} />
          </div>
        </div>
      </div>
    </div>
  );
}
