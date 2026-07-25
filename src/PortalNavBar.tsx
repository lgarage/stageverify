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

