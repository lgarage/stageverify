import { Navigate, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { AdminAppearanceProvider } from "./adminAppearance";
import { fetchOperatorSession, type OperatorSession } from "./operatorAuth";

export function OperatorProtectedRoute() {
  const { user, loading } = useAuth();
  const [operatorChecked, setOperatorChecked] = useState(false);
  const [isOperator, setIsOperator] = useState(false);

  useEffect(() => {
    if (!user) {
      setOperatorChecked(true);
      setIsOperator(false);
      return;
    }
    let cancelled = false;
    setOperatorChecked(false);
    void fetchOperatorSession()
      .then((session: OperatorSession) => {
        if (!cancelled) {
          setIsOperator(session.isOperator);
          setOperatorChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsOperator(false);
          setOperatorChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || (user && !operatorChecked)) {
    return (
      <div className="operator-loading-screen" data-testid="operator-auth-loading">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isOperator) {
    return <Navigate to="/no-access" replace />;
  }

  return (
    <AdminAppearanceProvider>
      <Outlet />
    </AdminAppearanceProvider>
  );
}
