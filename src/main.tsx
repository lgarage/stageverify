import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "./LoginPage";
import { seedFirestore } from "./dispatcher/seedFirestore";

const App = lazy(() => import("./App"));
const CheckInPage = lazy(() => import("./CheckInPage").then(m => ({ default: m.CheckInPage })));
const ReceivingPage = lazy(() => import("./ReceivingPage").then(m => ({ default: m.ReceivingPage })));
const EntryDisplayPage = lazy(() => import("./EntryDisplayPage").then(m => ({ default: m.EntryDisplayPage })));
const DispatcherDashboardPage = lazy(() => import("./DispatcherDashboardPage").then(m => ({ default: m.DispatcherDashboardPage })));
const SettingsPage = lazy(() => import("./SettingsPage").then(m => ({ default: m.SettingsPage })));
const MobileHubPage = lazy(() => import("./MobileHubPage").then(m => ({ default: m.MobileHubPage })));
const PickupPortalPage = lazy(() => import("./PickupPortalPage"));

const RootRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) return <App />;
  if (user) return <Navigate to="/hub" replace />;
  return <App />;
};

const root = createRoot(document.getElementById("root")!);

const renderApp = () => {
  root.render(
    <StrictMode>
      <AuthProvider>
        <HashRouter>
          <Suspense fallback={<div style={{ color: "#888", padding: "2rem", textAlign: "center" }}>Loading…</div>}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/pickup" element={<PickupPortalPage />} />
              <Route path="/checkin/:orderId" element={<CheckInPage />} />
              <Route path="/receive" element={<ReceivingPage />} />
              <Route path="/display" element={<EntryDisplayPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/dispatcher" element={<DispatcherDashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/hub" element={<MobileHubPage />} />
              </Route>
              <Route path="/" element={<RootRedirect />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AuthProvider>
    </StrictMode>,
  );
};

renderApp();
seedFirestore().catch((err) => {
  console.error("Firestore seed failed (app still works with empty DB):", err);
});
