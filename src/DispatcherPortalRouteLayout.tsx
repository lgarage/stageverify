import { Outlet } from "react-router-dom";
import { DispatcherPortalProvider } from "./dispatcher/DispatcherPortalContext";

export function DispatcherPortalRouteLayout() {
  return (
    <DispatcherPortalProvider>
      <Outlet />
    </DispatcherPortalProvider>
  );
}
