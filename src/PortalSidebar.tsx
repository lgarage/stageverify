import { Link, useLocation } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { PORTAL_SIDEBAR_CLASS } from "./dispatcherPortalLayout";
import { formatAppVersionLabel } from "./appVersion";
import {
  PORTAL_NAV_ITEMS,
  PORTAL_SETTINGS_ITEM,
  isPortalNavItemActive,
} from "./dispatcherPortalNav";
import { StageVerifyBrandMark } from "./StageVerifyBrandMark";

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
        <path key={i} d={i === 0 ? part : "M" + part} />
      ))}
    </svg>
  );
}

/** Shared navy sidebar for dispatcher portal pages. */
export function PortalSidebar({
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
  const isSettings = location.pathname === "/settings";
  const isMobile = variant === "mobile";

  return (
    <aside
      className={`${PORTAL_SIDEBAR_CLASS} ${isMobile ? "portal-sidebar--mobile" : ""} ${className}`.trim()}
      data-testid={isMobile ? "portal-mobile-nav-drawer" : undefined}
      role={isMobile ? "dialog" : undefined}
      aria-modal={isMobile ? "true" : undefined}
      aria-label={isMobile ? "Portal navigation" : undefined}
    >
      {isMobile ? (
        <div className="portal-mobile-nav-header">
          <span>Navigation</span>
          <button
            type="button"
            data-testid="portal-mobile-nav-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <svg
              width={20}
              height={20}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
      <div
        className="flex flex-col items-center px-5 pt-6 pb-5"
        data-testid="portal-sidebar-brand"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
      >
        {/* Full wordmark is designed for a light ground (SVG pagecolor white). */}
        <div
          data-testid="portal-sidebar-brand-logo-frame"
          style={{
            width: "100%",
            backgroundColor: "#ffffff",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <StageVerifyBrandMark
            variant="wordmark"
            height={34}
            data-testid="portal-sidebar-brand-mark"
            style={{ width: "100%" }}
          />
        </div>
        <span
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: 11,
            marginTop: 10,
          }}
        >
          Dispatcher Portal
        </span>
      </div>

      <div className="px-5 pt-6 pb-2">
        <span
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Main Menu
        </span>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-0.5">
        {PORTAL_NAV_ITEMS.map((item) => {
          const active = isPortalNavItemActive(
            item,
            location.pathname,
            location.search,
          );
          return (
            <Link
              key={item.label}
              to={item.to}
              data-testid={
                isMobile
                  ? `portal-mobile-nav-${item.to === "/dispatcher" ? "dispatcher" : item.to.slice(1)}`
                  : undefined
              }
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              style={navLinkStyle(active)}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--admin-on-navy)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "transparent";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.60)";
                }
              }}
            >
              <NavIcon icon={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="px-3 pb-2 shrink-0"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          paddingTop: 8,
        }}
      >
        <div
          data-testid="portal-sidebar-version"
          className="px-5 pb-2 text-center select-none"
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {formatAppVersionLabel()}
        </div>
        <Link
          to={PORTAL_SETTINGS_ITEM.to}
          data-testid={isMobile ? "portal-mobile-nav-settings" : undefined}
          aria-current={isSettings ? "page" : undefined}
          onClick={onNavigate}
          style={navLinkStyle(isSettings)}
          onMouseEnter={(e) => {
            if (!isSettings) {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "rgba(255,255,255,0.08)";
              (e.currentTarget as HTMLElement).style.color =
                "var(--admin-on-navy)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isSettings) {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "transparent";
              (e.currentTarget as HTMLElement).style.color =
                "rgba(255,255,255,0.60)";
            }
          }}
        >
          <NavIcon icon={PORTAL_SETTINGS_ITEM.icon} />
          {PORTAL_SETTINGS_ITEM.label}
        </Link>
      </div>

      {isMobile && mobileFooter ? (
        <div className="portal-mobile-nav-footer">{mobileFooter}</div>
      ) : null}

      <div
        className="px-5 py-4 text-center shrink-0"
        style={{
          borderTop: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.30)",
          fontSize: 11,
        }}
      >
        StageVerify
      </div>
    </aside>
  );
}
