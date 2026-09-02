import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { signOutWithConfirm } from "../signOutWithConfirm";
import { PORTAL_TOPBAR_CLASS } from "../portalLayout";
import { OperatorSidebar } from "./OperatorSidebar";

const NAVY = "#0a3161";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export type OperatorTopBarProps = {
  title: string;
  subtitle?: string;
  headerExtra?: ReactNode;
};

export function OperatorTopBar({
  title,
  subtitle,
  headerExtra,
}: OperatorTopBarProps) {
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  return (
    <div
      data-testid="operator-portal-topbar"
      className={PORTAL_TOPBAR_CLASS}
      style={{
        backgroundColor: "var(--admin-surface)",
        borderBottom: "1px solid var(--admin-border)",
        minHeight: 64,
        padding: "0 24px",
        display: "grid",
        gridTemplateColumns:
          "minmax(120px, 220px) max-content minmax(0, 1fr) max-content",
        alignItems: "center",
        columnGap: 12,
      }}
    >
      <button
        type="button"
        className="portal-mobile-nav-toggle"
        data-testid="operator-mobile-nav-toggle"
        aria-label="Open operator navigation"
        aria-expanded={mobileNavOpen}
        onClick={() => setMobileNavOpen(true)}
      >
        ☰
      </button>
      <div data-testid="operator-topbar-breadcrumb">
        <span style={{ color: "var(--admin-link)", fontWeight: 700, fontSize: 15 }}>
          {title}
        </span>
        {subtitle ? (
          <span style={{ color: "var(--admin-text-muted)", fontSize: 13 }}>
            {" "}
            / {subtitle}
          </span>
        ) : null}
      </div>
      <div className="portal-topbar-action-cluster">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {headerExtra}
        </div>
        <div aria-hidden="true" />
        <button
          type="button"
          className="admin-btn dispatcher-desktop-only"
          data-testid="operator-sign-out"
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
          }}
        >
          Sign Out
        </button>
      </div>
      {mobileNavOpen ? (
        <div
          id="operator-mobile-navigation"
          className="portal-mobile-nav-layer"
          data-testid="operator-mobile-nav-layer"
        >
          <button
            type="button"
            className="portal-mobile-nav-backdrop"
            data-testid="operator-mobile-nav-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <OperatorSidebar
            variant="mobile"
            onNavigate={() => setMobileNavOpen(false)}
            onClose={() => setMobileNavOpen(false)}
            mobileFooter={
              <button
                type="button"
                className="portal-mobile-sign-out"
                data-testid="operator-mobile-sign-out"
                onClick={() => signOutWithConfirm(auth, navigate)}
              >
                Sign Out
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
