import { Link, useLocation } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { PORTAL_SIDEBAR_CLASS } from "../portalLayout";
import { formatAppVersionLabel } from "../appVersion";
import { StageVerifyBrandMark } from "./StageVerifyBrandMark";
import {
  OPERATOR_NAV_ITEMS,
  isOperatorNavItemActive,
} from "../operatorNav";

const RED = "#bf0a30";

function navLinkStyle(active: boolean): CSSProperties {
  return active
    ? {
        backgroundColor: RED,
        color: "var(--admin-on-navy)",
        borderRadius: "var(--admin-radius-sm)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        fontWeight: 700,
        fontSize: 15,
        textDecoration: "none",
        boxShadow: "0 2px 8px rgba(191,10,48,0.35)",
      }
    : {
        color: "rgba(255,255,255,0.60)",
        borderRadius: "var(--admin-radius-sm)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 16px",
        fontWeight: 700,
        fontSize: 15,
        textDecoration: "none",
        transition: "background 0.15s, color 0.15s",
      };
}

function NavIcon({ icon }: { icon: string }) {
  return (
    <svg
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      style={{ flexShrink: 0 }}
    >
      {icon.split(" M").map((part, i) => (
        <path key={i} d={i === 0 ? part : `M${part}`} />
      ))}
    </svg>
  );
}

export function OperatorSidebar({
  className = "",
  variant = "desktop",
  onNavigate,
  onClose,
  mobileFooter,
}: {
  className?: string;
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  onClose?: () => void;
  mobileFooter?: ReactNode;
}) {
  const location = useLocation();
  const isMobile = variant === "mobile";

  return (
    <aside
      className={`${PORTAL_SIDEBAR_CLASS} ${isMobile ? "portal-sidebar--mobile" : ""} ${className}`.trim()}
      data-testid={isMobile ? "operator-mobile-nav-drawer" : "operator-sidebar"}
      role={isMobile ? "dialog" : undefined}
      aria-modal={isMobile ? "true" : undefined}
      aria-label={isMobile ? "Operator navigation" : undefined}
    >
      {isMobile ? (
        <div className="portal-mobile-nav-header">
          <span>Navigation</span>
          <button
            type="button"
            data-testid="operator-mobile-nav-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        className="operator-sidebar-brand"
        data-testid="operator-sidebar-brand"
      >
        <StageVerifyBrandMark
          variant="wordmark"
          height={34}
          data-testid="operator-sidebar-brand-mark"
          style={{ width: "100%" }}
        />
        <span className="operator-sidebar-subtitle">StageVerify Operator Console</span>
      </div>

      <div className="operator-sidebar-section-label">Main Menu</div>

      <nav className="operator-sidebar-nav">
        {OPERATOR_NAV_ITEMS.map((item) => {
          const active = isOperatorNavItemActive(item, location.pathname);
          return (
            <Link
              key={item.label}
              to={item.to}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              style={navLinkStyle(active)}
            >
              <NavIcon icon={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div
        data-testid="operator-sidebar-version"
        className="operator-sidebar-version"
      >
        {formatAppVersionLabel()}
      </div>

      {isMobile && mobileFooter ? (
        <div className="portal-mobile-nav-footer">{mobileFooter}</div>
      ) : null}
    </aside>
  );
}
