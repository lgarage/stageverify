import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

type PortalTab = "pickup" | "receive";

function tabClass(active: boolean): string {
  return active
    ? "rounded-full px-4 py-2 text-sm font-bold bg-accent text-white whitespace-nowrap"
    : "rounded-full px-4 py-2 text-sm font-bold border border-border bg-bg-surface text-text-primary whitespace-nowrap hover:border-accent/50";
}

/** Side-by-side Pickup Portal + Vendor Portal tabs for public mobile flows. */
export function PortalNavBar({ active }: { active?: PortalTab }) {
  return (
    <nav
      className="flex items-center justify-center gap-2"
      aria-label="Portal navigation"
    >
      <Link to="/pickup" className={tabClass(active === "pickup")}>
        Pickup Portal
      </Link>
      <Link to="/receive" className={tabClass(active === "receive")}>
        Vendor Portal
      </Link>
    </nav>
  );
}

const dispatcherLinkStyle: CSSProperties = {
  padding: "5px 12px",
  borderRadius: 4,
  border: "1.5px solid #0a3161",
  backgroundColor: "#fff",
  color: "#0a3161",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  textDecoration: "none",
  outline: "none",
  whiteSpace: "nowrap",
};

/** Dispatcher top bar — opens portals in a new tab. */
export function DispatcherPortalLinks() {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <Link to="/pickup" target="_blank" style={dispatcherLinkStyle}>
        Pickup Portal ↗
      </Link>
      <Link to="/receive" target="_blank" style={dispatcherLinkStyle}>
        Vendor Portal ↗
      </Link>
    </div>
  );
}
