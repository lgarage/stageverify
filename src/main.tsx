import { StrictMode, lazy, Suspense, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";
import { LoginPage } from "./LoginPage";
import { normalizeLegacyAppHash, normalizePickupHash, normalizeReceiveHash } from "./receiveQrUrls";
import { seedFirestore } from "./dispatcher/seedFirestore";

const ReceivingPage = lazy(() => import("./ReceivingPage").then(m => ({ default: m.ReceivingPage })));
const CheckinToReceiveRedirect = lazy(() =>
  import("./VendorCheckinRedirect").then((m) => ({
    default: m.CheckinToReceiveRedirect,
  })),
);
const EntryDisplayPage = lazy(() => import("./EntryDisplayPage").then(m => ({ default: m.EntryDisplayPage })));
const DispatcherDashboardPage = lazy(() => import("./DispatcherDashboardPage").then(m => ({ default: m.DispatcherDashboardPage })));
const SettingsPage = lazy(() => import("./SettingsPage").then(m => ({ default: m.SettingsPage })));
const ZoneManagementPage = lazy(() => import("./ZoneManagementPage").then(m => ({ default: m.ZoneManagementPage })));
const VendorsPage = lazy(() => import("./VendorsPage").then(m => ({ default: m.VendorsPage })));
const InvoiceReviewPage = lazy(() =>
  import("./InvoiceReviewPage").then((m) => ({ default: m.InvoiceReviewPage })),
);
const MobileHubPage = lazy(() => import("./MobileHubPage").then(m => ({ default: m.MobileHubPage })));
const PickupPortalPage = lazy(() => import("./PickupPortalPage"));
const VendorDemoScanPage = lazy(() =>
  import("./VendorDemoScanPage").then((m) => ({ default: m.VendorDemoScanPage })),
);
const PickupDemoScanPage = lazy(() =>
  import("./PickupDemoScanPage").then((m) => ({ default: m.PickupDemoScanPage })),
);

function CompactRouteSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  );
}

/** Compact `#/r?…` QRs rewrite to `#/receive?…` before content mounts. */
function CompactReceiveRedirect() {
  useLayoutEffect(() => {
    normalizeReceiveHash();
  }, []);
  return <CompactRouteSpinner label="Opening vendor check-in…" />;
}

function CompactPickupRedirect() {
  useLayoutEffect(() => {
    normalizePickupHash();
  }, []);
  return <CompactRouteSpinner label="Opening pickup portal…" />;
}

const RootRedirect = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return <CompactRouteSpinner label="Loading…" />;
  }
  if (user) return <Navigate to="/hub" replace />;
  return <Navigate to="/receive" replace />;
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
              <Route path="/p" element={<CompactPickupRedirect />} />
              <Route path="/checkin/:orderId" element={<CheckinToReceiveRedirect />} />
              <Route path="/receive" element={<ReceivingPage />} />
              <Route path="/r" element={<CompactReceiveRedirect />} />
              <Route path="/demo/vendor-scan" element={<VendorDemoScanPage />} />
              <Route path="/demo/pickup-scan" element={<PickupDemoScanPage />} />
              <Route path="/display" element={<EntryDisplayPage />} />
              <Route element={<ProtectedRoute />}>
                <Route path="/dispatcher" element={<DispatcherDashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/vendors" element={<VendorsPage />} />
                <Route path="/invoice-review" element={<InvoiceReviewPage />} />
                <Route path="/zones" element={<ZoneManagementPage />} />
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

normalizeLegacyAppHash();
normalizeReceiveHash();
normalizePickupHash();
renderApp();
if (import.meta.env.DEV) {
  seedFirestore().catch((err) => {
    console.error("Firestore seed failed:", err);
  });
}
