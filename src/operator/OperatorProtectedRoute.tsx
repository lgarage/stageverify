/**
 * Client-only prototype gate for operator routes — NOT a security boundary.
 * Fail-closed: unauthenticated users → /login; disallowed email → /no-access.
 * Does not use hasDispatcherAccess or dispatcherRoles (operator console is isolated).
 */
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { AdminAppearanceProvider } from "../adminAppearance";
import { isOperatorPrototypeAllowed } from "./operatorAccess";

export function OperatorProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          color: "#94a3b8",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isOperatorPrototypeAllowed(user.email)) {
    return <Navigate to="/no-access" replace />;
  }

  return (
    <AdminAppearanceProvider>
      <Outlet />
    </AdminAppearanceProvider>
  );
}
