import { PortalSidebar } from "./PortalSidebar";
import { InvoiceReviewPanel } from "./dispatcher/invoice/InvoiceReviewPanel";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_TOPBAR_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function InvoiceReviewPage() {
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
          <div className="flex items-center gap-3">
            <span style={{ color: NAVY, fontWeight: 700, fontSize: 15 }}>
              Invoice Review
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Johnstone import queue
            </span>
          </div>
        </div>

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

            <InvoiceReviewPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
