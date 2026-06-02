import { PortalSidebar } from "./PortalSidebar";
import { VendorsManagementPanel } from "./VendorsManagementPanel";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_TOPBAR_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function VendorsPage() {
  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
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
              Vendors
            </span>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>
              / Vendor Management
            </span>
          </div>
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
