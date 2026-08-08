import { Outlet, useLocation } from "react-router-dom";
import { AdminAppearanceProvider } from "./adminAppearance";
import { AdminAppearanceToggle } from "./AdminAppearanceToggle";
import { DispatcherPortalProvider } from "./dispatcher/DispatcherPortalContext";

function isPrintAdminRoute(pathname: string): boolean {
  return (
    pathname === "/zones/print-label" ||
    pathname.startsWith("/zones/print-label/") ||
    pathname === "/zones/print-labels" ||
    pathname.startsWith("/zones/print-labels/")
  );
}

export function DispatcherPortalRouteLayout() {
  const { pathname } = useLocation();
  const printRoute = isPrintAdminRoute(pathname);

  return (
    <AdminAppearanceProvider forceLight={printRoute}>
      <DispatcherPortalProvider>
        <Outlet />
        {!printRoute && <AdminAppearanceToggle />}
      </DispatcherPortalProvider>
    </AdminAppearanceProvider>
  );
}
