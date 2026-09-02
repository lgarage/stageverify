import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import { AuthProvider } from "./AuthContext";
import { OperatorProtectedRoute } from "./OperatorProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { NoAccessPage } from "./pages/NoAccessPage";

const OperatorDashboardPage = lazy(() =>
  import("./pages/OperatorDashboardPage").then((m) => ({
    default: m.OperatorDashboardPage,
  })),
);
const OperatorCustomersPage = lazy(() =>
  import("./pages/OperatorCustomersPage").then((m) => ({
    default: m.OperatorCustomersPage,
  })),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<div className="operator-loading-screen">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/no-access" element={<NoAccessPage />} />
            <Route element={<OperatorProtectedRoute />}>
              <Route path="/" element={<OperatorDashboardPage />} />
              <Route path="/customers/*" element={<OperatorCustomersPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
);
