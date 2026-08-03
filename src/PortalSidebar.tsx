import { Link, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";
import { PORTAL_SIDEBAR_CLASS } from "./dispatcherPortalLayout";
import { formatAppVersionLabel } from "./appVersion";
import {
  PORTAL_NAV_ITEMS,
  PORTAL_SETTINGS_ITEM,
  isPortalNavItemActive,
} from "./dispatcherPortalNav";

const NAVY = "#0a3161";
const RED = "#bf0a30";

function navLinkStyle(active: boolean): CSSProperties {
  return active
    ? {
        backgroundColor: RED,
        color: "#fff",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "18px 20px",
        fontWeight: 700,
        fontSize: 15,
        textDecoration: "none",
        boxShadow: "0 2px 8px rgba(191,10,48,0.35)",
      }
    : {
        color: "rgba(255,255,255,0.60)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "18px 20px",
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
export function PortalSidebar({ className = "" }: { className?: string }) {
  const location = useLocation();
  const isSettings = location.pathname === "/settings";

  return (
    <aside className={`${PORTAL_SIDEBAR_CLASS} ${className}`.trim()}>
      <div
        className="flex flex-col items-center px-6 pt-7 pb-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.10)" }}
      >
        <div
          className="flex items-center justify-center rounded-full mb-3"
          style={{
            width: 60,
            height: 60,
            backgroundColor: "#fff",
            border: `3px solid ${RED}`,
            boxShadow: "0 2px 12px rgba(0,0,0,0.20)",
          }}
        >
          <span
            style={{
              color: NAVY,
              fontWeight: 900,
              fontSize: 20,
              letterSpacing: "-0.04em",
            }}
          >
            SV
          </span>
        </div>
        <span
          style={{
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "0.08em",
          }}
        >
          STAGEVERIFY
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.45)",
            fontSize: 11,
            marginTop: 2,
          }}
        >
          Dispatcher Portal
        </span>
      </div>

      <div className="px-5 pt-5 pb-1">
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
              style={navLinkStyle(active)}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "rgba(255,255,255,0.08)";
                  (e.currentTarget as HTMLElement).style.color = "#fff";
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
          style={navLinkStyle(isSettings)}
          onMouseEnter={(e) => {
            if (!isSettings) {
              (e.currentTarget as HTMLElement).style.backgroundColor =
                "rgba(255,255,255,0.08)";
              (e.currentTarget as HTMLElement).style.color = "#fff";
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
